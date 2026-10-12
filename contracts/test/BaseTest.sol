// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IdentityRegistry} from "../src/identity/IdentityRegistry.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {AuditRegistry} from "../src/registry/AuditRegistry.sol";
import {RwaShareToken} from "../src/token/RwaShareToken.sol";
import {OfferingManager} from "../src/offering/OfferingManager.sol";
import {SubscriptionRouter} from "../src/offering/SubscriptionRouter.sol";
import {RevenueDistributor} from "../src/distribution/RevenueDistributor.sol";
import {
    ProjectFactory, TokenDeployer, OfferingDeployer, DistributorDeployer
} from "../src/factory/ProjectFactory.sol";
import {ProjectState, RecordKind} from "../src/interfaces/IRoboShare.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

/// @notice Shared fixture: full RoboShare deployment with distinct role holders.
abstract contract BaseTest is Test {
    address internal gov = makeAddr("gov"); // stands in for the governance Safe
    address internal operator = makeAddr("operator");
    address internal reviewer = makeAddr("reviewer");
    address internal pauser = makeAddr("pauser");
    address internal agent = makeAddr("complianceAgent");
    address internal treasury = makeAddr("treasury");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal attacker = makeAddr("attacker");

    uint256 internal constant ONE = 1e18; // 1 USDT in base units (mock uses 18 decimals)
    uint256 internal constant UNIT_PRICE = 1_000 * ONE;
    uint256 internal constant CLASS_MASK = 1 << 1; // only investor class 1 allowed

    bytes32 internal constant PID = keccak256("project-1");
    bytes32 internal constant ASSET_ID = keccak256("asset-1");
    bytes32 internal constant ISSUER_ID = keccak256("issuer-1");
    bytes32 internal constant RIGHTS_HASH = keccak256("rights-doc-v1");
    bytes32 internal constant TERMS_HASH = keccak256("terms-v1");
    bytes32 internal constant REASON = keccak256("reason");

    IdentityRegistry internal identity;
    AssetRegistry internal assets;
    AuditRegistry internal audit;
    MockUSDT internal usdt;
    SubscriptionRouter internal router;
    ProjectFactory internal factory;

    RwaShareToken internal token;
    OfferingManager internal offering;
    RevenueDistributor internal distributor;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        vm.roll(100);

        identity = new IdentityRegistry(gov);
        assets = new AssetRegistry(gov);
        audit = new AuditRegistry(gov);
        usdt = new MockUSDT();
        router = new SubscriptionRouter(IERC20(address(usdt)), assets, gov, pauser);
        factory = new ProjectFactory(
            assets,
            audit,
            identity,
            router,
            new TokenDeployer(),
            new OfferingDeployer(),
            new DistributorDeployer(),
            ProjectFactory.Roles({
                admin: gov, operator: operator, reviewer: reviewer, pauser: pauser, feeRecipient: feeRecipient
            }),
            gov
        );

        vm.startPrank(gov);
        identity.grantRole(identity.COMPLIANCE_AGENT_ROLE(), agent);
        identity.grantRole(identity.PAUSER_ROLE(), pauser);
        assets.grantRole(assets.OPERATOR_ROLE(), operator);
        assets.grantRole(assets.REVIEWER_ROLE(), reviewer);
        assets.grantRole(assets.PAUSER_ROLE(), pauser);
        assets.grantRole(assets.FACTORY_ROLE(), address(factory));
        audit.grantRole(audit.OPERATOR_ROLE(), operator);
        audit.grantRole(audit.REVIEWER_ROLE(), reviewer);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _makeEligible(address wallet) internal {
        vm.prank(agent);
        identity.setEligibility(wallet, 1, 840, uint64(block.timestamp + 365 days), keccak256(abi.encode(wallet)));
    }

    function _registerAndVerify() internal {
        vm.prank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.prank(reviewer);
        assets.transition(PID, ProjectState.VERIFIED, REASON);
    }

    /// @dev 360 days keeps the standard fee tiers of the TOKENOMICS examples; 0 leaves the term unset (default 720).
    uint32 internal projectTermDays = 360;

    function _deployProject() internal {
        _registerAndVerify();
        if (projectTermDays != 0) {
            vm.prank(operator);
            assets.setOperatingTerm(PID, projectTermDays);
        }
        vm.prank(gov);
        ProjectFactory.Deployment memory d = factory.deployProject(
            ProjectFactory.ProjectParams({
                projectId: PID, name: "RoboShare Vehicle 1", symbol: "RSV1", allowedClassesMask: CLASS_MASK, treasury: treasury
            })
        );
        token = RwaShareToken(d.token);
        offering = OfferingManager(d.offering);
        distributor = RevenueDistributor(d.distributor);
    }

    function _defaultConfig(uint32 minUnits) internal view returns (OfferingManager.OfferingConfig memory) {
        return OfferingManager.OfferingConfig({
            unitPrice: UNIT_PRICE,
            minUnits: minUnits,
            maxUnits: 100,
            perWalletMax: 100,
            startTime: uint64(block.timestamp),
            endTime: uint64(block.timestamp + 30 days),
            treasury: treasury,
            termsHash: TERMS_HASH
        });
    }

    function _openOffering(uint32 minUnits) internal {
        _deployProject();
        vm.startPrank(gov);
        offering.configure(_defaultConfig(minUnits));
        offering.open();
        vm.stopPrank();
    }

    /// @dev Funds the investor, approves the router once (unlimited) and subscribes.
    function _subscribe(address investor, uint32 units) internal {
        uint256 cost = uint256(units) * UNIT_PRICE;
        usdt.mint(investor, cost);
        vm.startPrank(investor);
        usdt.approve(address(router), type(uint256).max);
        router.subscribe(PID, units, cost);
        vm.stopPrank();
    }

    /// @dev Opens, subscribes each holder, settles and activates. Returns with block advanced.
    function _fundAndActivate(address[] memory holders, uint32[] memory units) internal {
        uint32 total;
        for (uint256 i; i < units.length; ++i) {
            total += units[i];
        }
        _openOffering(total);
        for (uint256 i; i < holders.length; ++i) {
            _makeEligible(holders[i]);
            _subscribe(holders[i], units[i]);
        }
        vm.warp(block.timestamp + 31 days);
        vm.prank(operator);
        offering.settle();
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        vm.roll(block.number + 1);
    }

    function _approvedReport(uint256 distributable, uint64 start, uint64 end) internal returns (bytes32 id) {
        vm.prank(operator);
        id = audit.submitRecord(
            AuditRegistry.RecordInput({
                projectId: PID,
                kind: RecordKind.FINANCIAL_REPORT,
                contentHash: keccak256(abi.encode("report", start, end, distributable)),
                docType: "PNL_REPORT",
                offchainRef: keccak256("storage-key"),
                periodStart: start,
                periodEnd: end,
                distributableAmount: distributable,
                paymentToken: address(usdt)
            })
        );
        vm.prank(reviewer);
        audit.approve(id);
    }

    /// @dev Returns `addrs` sorted ascending (insertion sort, small arrays only).
    function _sorted(address[] memory addrs) internal pure returns (address[] memory) {
        for (uint256 i = 1; i < addrs.length; ++i) {
            address key = addrs[i];
            uint256 j = i;
            while (j > 0 && addrs[j - 1] > key) {
                addrs[j] = addrs[j - 1];
                --j;
            }
            addrs[j] = key;
        }
        return addrs;
    }

    function _fundTreasury(uint256 amount) internal {
        usdt.mint(treasury, amount);
        vm.prank(treasury);
        usdt.approve(address(distributor), amount);
    }
}
