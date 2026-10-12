// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IdentityRegistry} from "../../src/identity/IdentityRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {AuditRegistry} from "../../src/registry/AuditRegistry.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {OfferingManager} from "../../src/offering/OfferingManager.sol";
import {SubscriptionRouter} from "../../src/offering/SubscriptionRouter.sol";
import {RevenueDistributor} from "../../src/distribution/RevenueDistributor.sol";
import {ProjectFactory} from "../../src/factory/ProjectFactory.sol";
import {
    IAssetRegistry,
    IAuditRegistry,
    IIdentityRegistry,
    IRwaShareToken,
    ProjectState,
    RecordKind
} from "../../src/interfaces/IRoboShare.sol";

/// Required test 9/11 (continued): input validation and access-control branches of every contract.
contract ConstructorValidationTest is BaseTest {
    function test_RevertWhen_ZeroAdmins() public {
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        new IdentityRegistry(address(0));
        vm.expectRevert(AssetRegistry.ZeroValue.selector);
        new AssetRegistry(address(0));
        vm.expectRevert(AuditRegistry.ZeroValue.selector);
        new AuditRegistry(address(0));
        vm.expectRevert(SubscriptionRouter.ZeroValue.selector);
        new SubscriptionRouter(IERC20(address(0)), assets, gov, pauser);
    }

    function test_RevertWhen_TokenOrOfferingMisconfigured() public {
        vm.expectRevert(RwaShareToken.ZeroValue.selector);
        new RwaShareToken("n", "s", bytes32(0), assets, identity, gov, pauser, gov);
        vm.expectRevert(OfferingManager.ZeroValue.selector);
        new OfferingManager(PID, assets, identity, IRwaShareToken(address(0)), address(router), gov, operator, pauser);
    }

    function _params() internal view returns (RevenueDistributor.Params memory p) {
        uint32[] memory mins = new uint32[](2);
        uint16[] memory bps = new uint16[](2);
        (mins[0], mins[1], bps[0], bps[1]) = (1, 10, 2000, 1500);
        p = RevenueDistributor.Params({
            projectId: PID,
            assetRegistry: assets,
            auditRegistry: audit,
            identityRegistry: identity,
            token: IRwaShareToken(address(0x1234)),
            paymentToken: IERC20(address(usdt)),
            treasury: treasury,
            feeRecipient: feeRecipient,
            admin: gov,
            operator: operator,
            reviewer: reviewer,
            pauser: pauser,
            tierMinUnits: mins,
            tierBps: bps
        });
    }

    function test_DistributorValidatesParamsAndTiers() public {
        new RevenueDistributor(_params()); // valid

        RevenueDistributor.Params memory p = _params();
        p.treasury = address(0);
        vm.expectRevert(RevenueDistributor.ZeroValue.selector);
        new RevenueDistributor(p);

        p = _params();
        p.tierMinUnits[0] = 2; // must start at 1
        vm.expectRevert();
        new RevenueDistributor(p);

        p = _params();
        p.tierBps[1] = 2500; // fees must not rise with size
        vm.expectRevert();
        new RevenueDistributor(p);

        p = _params();
        p.tierMinUnits[1] = 1; // thresholds strictly ascending
        vm.expectRevert();
        new RevenueDistributor(p);

        p = _params();
        p.tierBps[0] = 10_001;
        vm.expectRevert();
        new RevenueDistributor(p);

        p = _params();
        p.tierBps = new uint16[](1); // length mismatch
        vm.expectRevert();
        new RevenueDistributor(p);
    }

    function test_FactoryValidation() public {
        vm.prank(gov);
        vm.expectRevert(); // project not registered
        factory.deployProject(
            ProjectFactory.ProjectParams({projectId: PID, name: "n", symbol: "s", treasury: treasury})
        );
        _registerAndVerify();
        vm.prank(gov);
        vm.expectRevert(ProjectFactory.ZeroValue.selector);
        factory.deployProject(
            ProjectFactory.ProjectParams({projectId: PID, name: "n", symbol: "s", treasury: address(0)})
        );
        vm.prank(gov);
        vm.expectRevert(ProjectFactory.ZeroValue.selector);
        factory.setRoles(
            ProjectFactory.Roles({admin: address(0), operator: operator, reviewer: reviewer, pauser: pauser, feeRecipient: feeRecipient})
        );
    }
}

contract IdentityBranchesTest is BaseTest {
    function test_FrozenWalletCannotBeFrozenOrUnfrozenTwice() public {
        address w = makeAddr("w");
        vm.startPrank(agent);
        vm.expectRevert(IdentityRegistry.ZeroAddress.selector);
        identity.freeze(address(0), "X");
        identity.freeze(w, "X");
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.WalletIsFrozen.selector, w));
        identity.freeze(w, "X");
        vm.stopPrank();
        vm.prank(gov);
        identity.unfreeze(w);
        vm.prank(gov);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.WalletNotFrozen.selector, w));
        identity.unfreeze(w);
    }
}

contract AssetRegistryBranchesTest is BaseTest {
    function test_RegistrationAndDraftValidation() public {
        vm.startPrank(operator);
        vm.expectRevert(AssetRegistry.ZeroValue.selector);
        assets.registerProject(PID, 0, ISSUER_ID, RIGHTS_HASH);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.expectRevert(AssetRegistry.ZeroValue.selector);
        assets.updateDraft(PID, 0, RIGHTS_HASH);
        assets.updateDraft(PID, keccak256("issuer-2"), RIGHTS_HASH);
        vm.stopPrank();
        vm.prank(reviewer);
        assets.transition(PID, ProjectState.VERIFIED, REASON);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidTransition.selector, ProjectState.VERIFIED, ProjectState.DRAFT));
        assets.updateDraft(PID, ISSUER_ID, RIGHTS_HASH);
    }

    function test_TransitionRoleChecks() public {
        vm.prank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, attacker));
        assets.transition(PID, ProjectState.VERIFIED, REASON);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, attacker));
        assets.transition(PID, ProjectState.CANCELLED, REASON);
        vm.prank(operator);
        assets.transition(PID, ProjectState.CANCELLED, REASON);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.CANCELLED));
        assertEq(uint8(assets.stateOf(keccak256("nope"))), 0); // unknown projects read as DRAFT (zero value)
    }

    function test_GovernanceOnlyTransitions() public {
        _fundAndActivate(_one(makeAddr("h")), _units(100));
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, attacker));
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(pauser);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(pauser);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, pauser));
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        vm.prank(pauser);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, pauser));
        assets.transition(PID, ProjectState.TERMINATED, REASON);
        vm.prank(gov);
        assets.transition(PID, ProjectState.TERMINATED, REASON);
    }

    function test_LinkAndMarkGuards() public {
        vm.prank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.prank(gov);
        assets.grantRole(keccak256("FACTORY_ROLE"), address(this));
        vm.expectRevert();
        assets.linkContracts(PID, address(1), address(2), address(3)); // still DRAFT
        vm.prank(reviewer);
        assets.transition(PID, ProjectState.VERIFIED, REASON);
        vm.expectRevert(AssetRegistry.ZeroValue.selector);
        assets.linkContracts(PID, address(0), address(2), address(3));
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.NotLinked.selector, PID));
        assets.markOffering(PID, REASON);
        assets.linkContracts(PID, address(1), address(2), address(3));
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AlreadyLinked.selector, PID));
        assets.linkContracts(PID, address(1), address(2), address(3));
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, address(this)));
        assets.markOffering(PID, REASON);
        vm.prank(address(2));
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidTransition.selector, ProjectState.VERIFIED, ProjectState.FUNDED));
        assets.markFunded(PID, REASON);
    }

    function _one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _units(uint32 u) internal pure returns (uint32[] memory r) {
        r = new uint32[](1);
        r[0] = u;
    }
}

contract AuditRegistryBranchesTest is BaseTest {
    function _input(bytes32 h, uint64 start, uint64 end) internal view returns (AuditRegistry.RecordInput memory) {
        return AuditRegistry.RecordInput({
            projectId: PID,
            kind: RecordKind.FINANCIAL_REPORT,
            contentHash: h,
            docType: "PNL_REPORT",
            offchainRef: 0,
            periodStart: start,
            periodEnd: end,
            distributableAmount: 1_000,
            paymentToken: address(usdt)
        });
    }

    function test_AmendmentRules() public {
        vm.prank(operator);
        bytes32 id = audit.submitRecord(_input("a", 1, 2));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.InvalidAmendment.selector, id));
        audit.submitAmendment(id, _input("b", 1, 2)); // not approved yet
        vm.prank(reviewer);
        audit.approve(id);

        AuditRegistry.RecordInput memory wrongPeriod = _input("c", 1, 3);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.InvalidAmendment.selector, id));
        audit.submitAmendment(id, wrongPeriod);

        AuditRegistry.RecordInput memory wrongType = _input("d", 1, 2);
        wrongType.docType = "OTHER";
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.InvalidAmendment.selector, id));
        audit.submitAmendment(id, wrongType);

        // Two amendments of the same report: only the first approved one can supersede it.
        vm.startPrank(operator);
        bytes32 a1 = audit.submitAmendment(id, _input("e", 1, 2));
        bytes32 a2 = audit.submitAmendment(id, _input("f", 1, 2));
        vm.stopPrank();
        vm.prank(reviewer);
        audit.approve(a1);
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.InvalidAmendment.selector, id));
        audit.approve(a2);
    }

    function test_ReviewGuards() public {
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.UnknownRecord.selector, bytes32("x")));
        audit.approve("x");
        vm.prank(operator);
        bytes32 id = audit.submitRecord(_input("a", 1, 2));
        vm.prank(reviewer);
        vm.expectRevert(AuditRegistry.ZeroValue.selector);
        audit.reject(id, 0);
        vm.prank(gov);
        audit.grantRole(keccak256("REVIEWER_ROLE"), operator);
        vm.prank(operator);
        vm.expectRevert(AuditRegistry.SelfApproval.selector);
        audit.reject(id, REASON);
        vm.prank(reviewer);
        audit.reject(id, REASON);
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.NotSubmitted.selector, id));
        audit.approve(id);
    }
}

contract TokenBranchesTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        address[] memory h = new address[](1);
        h[0] = alice;
        uint32[] memory u = new uint32[](1);
        u[0] = 100;
        _fundAndActivate(h, u);
    }

    function test_CanTransferReasons() public {
        (bool ok, bytes32 why) = token.canTransfer(alice, bob, 0);
        assertEq(why, token.REASON_ZERO_AMOUNT());
        _freeze(bob);
        (ok, why) = token.canTransfer(alice, bob, 1);
        assertEq(why, token.REASON_RECEIVER_FROZEN());
        vm.prank(gov);
        identity.unfreeze(bob);
        (ok, why) = token.canTransfer(alice, bob, 101);
        assertEq(why, token.REASON_BALANCE());
        (ok, why) = token.canTransfer(alice, bob, 1);
        assertTrue(ok);
        assertEq(why, token.REASON_OK());
        vm.prank(agent);
        identity.freeze(alice, "X");
        (, why) = token.canTransfer(alice, bob, 1);
        assertEq(why, token.REASON_SENDER_FROZEN());
        vm.prank(pauser);
        token.pause();
        (, why) = token.canTransfer(alice, bob, 1);
        assertEq(why, token.REASON_PAUSED());
        vm.prank(gov);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(gov);
        token.unpause();
        (, why) = token.canTransfer(alice, bob, 1);
        assertEq(why, token.REASON_STATE());
    }

    function test_BindMinterGuards() public {
        vm.expectRevert(RwaShareToken.OnlyMinterBinder.selector);
        token.bindMinter(address(1));
        vm.prank(address(factory));
        vm.expectRevert(RwaShareToken.MinterAlreadyBound.selector);
        token.bindMinter(address(1));
        RwaShareToken fresh = new RwaShareToken("n", "s", PID, assets, identity, gov, pauser, address(this));
        vm.expectRevert(RwaShareToken.ZeroValue.selector);
        fresh.bindMinter(address(0));
    }

    function test_SupplyLookupRejectsFuture() public {
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.FutureLookup.selector, block.number));
        token.totalSupplyAt(block.number);
        assertEq(token.totalSupplyAt(block.number - 1), 100);
    }
}

contract OfferingBranchesTest is BaseTest {
    address internal alice = makeAddr("alice");

    function test_ConfigureAndOpenGuards() public {
        _deployProject();
        vm.startPrank(gov);
        vm.expectRevert(OfferingManager.NotConfigured.selector);
        offering.open();
        OfferingManager.OfferingConfig memory bad = _defaultConfig(10);
        bad.maxUnits = 99;
        vm.expectRevert(OfferingManager.InvalidConfig.selector);
        offering.configure(bad);
        bad = _defaultConfig(10);
        bad.endTime = bad.startTime;
        vm.expectRevert(OfferingManager.InvalidConfig.selector);
        offering.configure(bad);
        offering.configure(_defaultConfig(10));
        vm.expectRevert(OfferingManager.AlreadyConfigured.selector);
        offering.configure(_defaultConfig(10));
        offering.open();
        vm.expectRevert(OfferingManager.AlreadyOpened.selector);
        offering.open();
        vm.stopPrank();
    }

    function test_ConfigureRequiresVerifiedProject() public {
        _deployProject();
        vm.prank(gov);
        assets.transition(PID, ProjectState.CANCELLED, REASON);
        vm.prank(gov);
        vm.expectRevert();
        offering.configure(_defaultConfig(10));
    }

    function test_SubscribeGuards() public {
        _deployProject();
        vm.prank(address(router));
        vm.expectRevert(OfferingManager.NotOpen.selector);
        offering.subscribeFor(alice, 1, UNIT_PRICE);

        vm.startPrank(gov);
        OfferingManager.OfferingConfig memory c = _defaultConfig(10);
        c.startTime = uint64(block.timestamp + 1 days);
        offering.configure(c);
        offering.open();
        vm.stopPrank();
        vm.prank(address(router));
        vm.expectRevert(OfferingManager.OfferingWindowClosed.selector);
        offering.subscribeFor(alice, 1, UNIT_PRICE);

        vm.warp(block.timestamp + 1 days);
        vm.startPrank(address(router));
        vm.expectRevert(OfferingManager.ZeroValue.selector);
        offering.subscribeFor(alice, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.CostMismatch.selector, UNIT_PRICE, 1));
        offering.subscribeFor(alice, 1, 1);
        vm.stopPrank();

        _freeze(alice);
        vm.prank(address(router));
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.InvestorFrozen.selector, alice));
        offering.subscribeFor(alice, 1, UNIT_PRICE);
    }

    function test_RouterRejectsZeroUnits() public {
        _openOffering(10);
        vm.expectRevert(SubscriptionRouter.ZeroValue.selector);
        router.subscribe(PID, 0, 0);
    }

    function test_ExcludedWalletCannotSubscribeAgain() public {
        _openOffering(10);
        _subscribe(alice, 5);
        vm.prank(gov);
        offering.excludeSubscriber(alice, REASON);
        vm.prank(gov);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.NotRefundable.selector, alice));
        offering.excludeSubscriber(alice, REASON);
        usdt.mint(alice, UNIT_PRICE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.SubscriptionClosedForWallet.selector, alice));
        router.subscribe(PID, 1, UNIT_PRICE);
    }

    function test_FinalizeAndCancelGuards() public {
        _deployProject();
        vm.expectRevert(OfferingManager.NotOpen.selector);
        offering.finalizeFailed();
        vm.prank(operator);
        vm.expectRevert(OfferingManager.NotOpen.selector);
        offering.settle();
        vm.prank(gov);
        vm.expectRevert(OfferingManager.NotOpen.selector);
        offering.cancel(REASON);

        vm.startPrank(gov);
        offering.configure(_defaultConfig(10));
        offering.open();
        vm.expectRevert(OfferingManager.ZeroValue.selector);
        offering.cancel(0);
        vm.stopPrank();
        vm.expectRevert(OfferingManager.FailureConditionsNotMet.selector);
        offering.finalizeFailed(); // window still open

        vm.warp(block.timestamp + 31 days);
        offering.finalizeFailed(); // nothing sold
        vm.expectRevert(OfferingManager.OfferingFinalized.selector);
        offering.finalizeFailed();
        vm.prank(operator);
        vm.expectRevert(OfferingManager.OfferingFinalized.selector);
        offering.settle();
        vm.prank(gov);
        vm.expectRevert(OfferingManager.OfferingFinalized.selector);
        offering.cancel(REASON);
        vm.prank(gov);
        vm.expectRevert(OfferingManager.OfferingFinalized.selector);
        offering.excludeSubscriber(alice, REASON);
        vm.prank(address(router));
        vm.expectRevert(OfferingManager.OfferingFinalized.selector);
        offering.subscribeFor(alice, 1, UNIT_PRICE);
    }
}

contract DistributorBranchesTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        address[] memory h = new address[](2);
        (h[0], h[1]) = (alice, bob);
        uint32[] memory u = new uint32[](2);
        (u[0], u[1]) = (60, 40);
        _fundAndActivate(h, u);
    }

    function _holders() internal view returns (address[] memory h) {
        h = new address[](2);
        (h[0], h[1]) = (alice, bob);
        h = _sorted(h);
    }

    function test_BatchStateGuards() public {
        vm.startPrank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.NotProposed.selector, 7));
        distributor.approveBatch(7);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.NotProposed.selector, 7));
        distributor.rejectBatch(7, REASON);
        vm.expectRevert(RevenueDistributor.ZeroValue.selector);
        distributor.rejectBatch(7, 0);
        vm.stopPrank();
    }

    function test_RevertWhen_HolderHasNoUnitsOrTooMany() public {
        bytes32 r = _approvedReport(1_000 * ONE, 1, 2);
        address[] memory h = new address[](3);
        (h[0], h[1], h[2]) = (alice, bob, makeAddr("nobody"));
        h = _sorted(h);
        vm.prank(operator);
        vm.expectRevert();
        distributor.proposeBatch(r, ONE, uint64(block.number - 1), h);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.TooManyHolders.selector, 101));
        distributor.proposeBatch(r, ONE, uint64(block.number - 1), new address[](101));
    }

    function test_RevertWhen_ProjectNotDistributing() public {
        bytes32 r = _approvedReport(1_000 * ONE, 1, 2);
        vm.prank(gov);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.ProjectStateInvalid.selector, ProjectState.SUSPENDED));
        distributor.proposeBatch(r, ONE, uint64(block.number - 1), _holders());
    }

    function test_RevertWhen_TreasuryUnderfunded() public {
        bytes32 r = _approvedReport(1_000 * ONE, 1, 2);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(r, 1_000 * ONE, uint64(block.number - 1), _holders());
        vm.prank(reviewer);
        vm.expectRevert(); // no allowance / balance
        distributor.approveBatch(id);
    }

    function test_SweepDustNothingToSweep() public {
        vm.startPrank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);
        assets.transition(PID, ProjectState.CLOSED, REASON);
        vm.expectRevert(RevenueDistributor.ZeroValue.selector);
        distributor.sweepDust();
        vm.stopPrank();
    }

    function test_ClaimManyAndUnpause() public {
        bytes32 r = _approvedReport(1_000 * ONE, 1, 2);
        _fundTreasury(1_000 * ONE);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(r, 1_000 * ONE, uint64(block.number - 1), _holders());
        vm.prank(reviewer);
        distributor.approveBatch(id);
        vm.prank(pauser);
        distributor.pause();
        vm.prank(gov);
        distributor.unpause();
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(alice);
        distributor.claimMany(ids);
        assertGt(usdt.balanceOf(alice), 0);
        (uint32[] memory mins, uint16[] memory bps) = distributor.tiers();
        assertEq(mins.length, bps.length);
    }
}
