// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IdentityRegistry} from "../src/identity/IdentityRegistry.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {AuditRegistry} from "../src/registry/AuditRegistry.sol";
import {SubscriptionRouter} from "../src/offering/SubscriptionRouter.sol";
import {ReferralRewards} from "../src/referral/ReferralRewards.sol";
import {ProjectFactory, TokenDeployer, OfferingDeployer, DistributorDeployer} from "../src/factory/ProjectFactory.sol";
import {MockUSDT} from "../test/mocks/MockUSDT.sol";

/// @notice Deploys the RoboShare singletons and hands admin to a 24h timelock controlled by the Safe (D-16).
/// @dev Required env: SAFE, OPERATOR, REVIEWER, PAUSER, COMPLIANCE_AGENT, FEE_RECIPIENT.
///      USDT is required on BSC mainnet (56). Elsewhere it is optional; when absent a TEST-ONLY MockUSDT
///      is deployed. Mainnet also requires CONFIRM_MAINNET=I_UNDERSTAND_THIS_IS_MAINNET.
contract Deploy is Script {
    uint256 internal constant BSC_MAINNET = 56;
    uint256 internal constant TIMELOCK_DELAY = 24 hours;
    bytes32 internal constant MAINNET_CONFIRMATION = keccak256("I_UNDERSTAND_THIS_IS_MAINNET");

    struct Config {
        address safe;
        address operator;
        address reviewer;
        address pauser;
        address complianceAgent;
        address feeRecipient;
        address usdt;
    }

    struct Deployed {
        TimelockController timelock;
        IdentityRegistry identity;
        AssetRegistry assets;
        AuditRegistry audit;
        SubscriptionRouter router;
        ProjectFactory factory;
        ReferralRewards referralRewards;
        address usdt;
        bool usdtIsMock;
    }

    error MainnetNotConfirmed();
    error MissingUsdt();
    error MissingAddress(string name);
    error UnexpectedUsdtDecimals(uint8 decimals);
    error RoleCheckFailed(string what);

    function run() external returns (Deployed memory d) {
        Config memory c = _loadConfig();
        vm.startBroadcast();
        d = deploy(c, msg.sender);
        vm.stopBroadcast();
        _log(d);
    }

    function deploy(Config memory c, address deployer) public returns (Deployed memory d) {
        d.usdt = c.usdt;
        if (d.usdt == address(0)) {
            d.usdt = address(new MockUSDT()); // reverts on chain 56
            d.usdtIsMock = true;
        }

        address[] memory safeOnly = new address[](1);
        safeOnly[0] = c.safe;
        d.timelock = new TimelockController(TIMELOCK_DELAY, safeOnly, safeOnly, address(0));

        d.identity = new IdentityRegistry(deployer);
        d.assets = new AssetRegistry(deployer);
        d.audit = new AuditRegistry(deployer);
        d.router = new SubscriptionRouter(IERC20(d.usdt), d.assets, address(d.timelock), c.pauser);
        // Referrals ship switched off in both contracts; only the timelock can enable them.
        d.referralRewards = new ReferralRewards(IERC20(d.usdt), address(d.timelock), c.operator, c.pauser);
        d.factory = new ProjectFactory(
            d.assets,
            d.audit,
            d.identity,
            d.router,
            new TokenDeployer(),
            new OfferingDeployer(),
            new DistributorDeployer(),
            ProjectFactory.Roles({
                admin: address(d.timelock),
                operator: c.operator,
                reviewer: c.reviewer,
                pauser: c.pauser,
                feeRecipient: c.feeRecipient
            }),
            address(d.timelock)
        );

        d.identity.grantRole(d.identity.COMPLIANCE_AGENT_ROLE(), c.complianceAgent);
        d.identity.grantRole(d.identity.PAUSER_ROLE(), c.pauser);
        d.assets.grantRole(d.assets.OPERATOR_ROLE(), c.operator);
        d.assets.grantRole(d.assets.REVIEWER_ROLE(), c.reviewer);
        d.assets.grantRole(d.assets.PAUSER_ROLE(), c.pauser);
        d.assets.grantRole(d.assets.FACTORY_ROLE(), address(d.factory));
        d.audit.grantRole(d.audit.OPERATOR_ROLE(), c.operator);
        d.audit.grantRole(d.audit.REVIEWER_ROLE(), c.reviewer);

        bytes32 admin = 0x00;
        d.identity.grantRole(admin, address(d.timelock));
        d.assets.grantRole(admin, address(d.timelock));
        d.audit.grantRole(admin, address(d.timelock));
        d.identity.renounceRole(admin, deployer);
        d.assets.renounceRole(admin, deployer);
        d.audit.renounceRole(admin, deployer);

        _verify(d, c, deployer);
    }

    function _verify(Deployed memory d, Config memory c, address deployer) internal view {
        bytes32 admin = 0x00;
        _check(d.identity.hasRole(admin, address(d.timelock)), "identity admin");
        _check(d.assets.hasRole(admin, address(d.timelock)), "assets admin");
        _check(d.audit.hasRole(admin, address(d.timelock)), "audit admin");
        _check(d.router.hasRole(admin, address(d.timelock)), "router admin");
        _check(d.factory.hasRole(admin, address(d.timelock)), "factory admin");
        _check(!d.identity.hasRole(admin, deployer), "identity deployer renounced");
        _check(!d.assets.hasRole(admin, deployer), "assets deployer renounced");
        _check(!d.audit.hasRole(admin, deployer), "audit deployer renounced");
        _check(!d.router.hasRole(admin, deployer) || deployer == address(d.timelock), "router deployer");
        _check(!d.factory.hasRole(admin, deployer) || deployer == address(d.timelock), "factory deployer");
        _check(d.timelock.getMinDelay() == TIMELOCK_DELAY, "timelock delay");
        _check(d.timelock.hasRole(d.timelock.PROPOSER_ROLE(), c.safe), "safe proposer");
        _check(d.timelock.hasRole(d.timelock.EXECUTOR_ROLE(), c.safe), "safe executor");
        _check(!d.timelock.hasRole(admin, deployer), "timelock has no deployer admin");
        _check(d.referralRewards.hasRole(admin, address(d.timelock)), "referral admin");
        _check(!d.referralRewards.hasRole(admin, deployer) || deployer == address(d.timelock), "referral deployer");
        _check(d.referralRewards.hasRole(d.referralRewards.ROOT_SETTER_ROLE(), c.operator), "referral root setter");
        _check(address(d.referralRewards.paymentToken()) == d.usdt, "referral usdt");
        _check(!d.router.referralsEnabled() && !d.referralRewards.claimsEnabled(), "referrals start disabled");
        _check(d.assets.hasRole(d.assets.FACTORY_ROLE(), address(d.factory)), "factory role");
        _check(d.identity.hasRole(d.identity.COMPLIANCE_AGENT_ROLE(), c.complianceAgent), "agent role");
        _check(address(d.router.USDT()) == d.usdt, "router usdt");
        _check(d.usdt.code.length > 0, "usdt has code");
    }

    function _loadConfig() internal view returns (Config memory c) {
        c.safe = _required("SAFE");
        c.operator = _required("OPERATOR");
        c.reviewer = _required("REVIEWER");
        c.pauser = _required("PAUSER");
        c.complianceAgent = _required("COMPLIANCE_AGENT");
        c.feeRecipient = _required("FEE_RECIPIENT");
        c.usdt = vm.envOr("USDT", address(0));

        if (block.chainid == BSC_MAINNET) {
            if (keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) != MAINNET_CONFIRMATION) {
                revert MainnetNotConfirmed();
            }
            if (c.usdt == address(0)) revert MissingUsdt();
            // BSC USDT (BEP20) uses 18 decimals; verify against the live contract before trusting the address.
            uint8 dec = IERC20Metadata(c.usdt).decimals();
            if (dec != 18) revert UnexpectedUsdtDecimals(dec);
        }
    }

    function _required(string memory name) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) revert MissingAddress(name);
    }

    function _check(bool ok, string memory what) internal pure {
        if (!ok) revert RoleCheckFailed(what);
    }

    function _log(Deployed memory d) internal pure {
        console2.log("chainId check passed; USDT is TEST-ONLY mock:", d.usdtIsMock);
        console2.log("TimelockController", address(d.timelock));
        console2.log("IdentityRegistry  ", address(d.identity));
        console2.log("AssetRegistry     ", address(d.assets));
        console2.log("AuditRegistry     ", address(d.audit));
        console2.log("SubscriptionRouter", address(d.router));
        console2.log("ProjectFactory    ", address(d.factory));
        console2.log("ReferralRewards   ", address(d.referralRewards));
        console2.log("USDT              ", d.usdt);
    }
}
