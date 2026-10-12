// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IdentityRegistry} from "../src/identity/IdentityRegistry.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {AuditRegistry} from "../src/registry/AuditRegistry.sol";
import {SubscriptionRouter} from "../src/offering/SubscriptionRouter.sol";
import {ReferralRewards} from "../src/referral/ReferralRewards.sol";
import {ShareMarket} from "../src/market/ShareMarket.sol";
import {ProjectFactory, TokenDeployer, OfferingDeployer, DistributorDeployer} from "../src/factory/ProjectFactory.sol";
import {MockUSDT} from "../test/mocks/MockUSDT.sol";

/// @notice Deploys the RoboShare singletons and hands admin straight to the 2/3 Safe (D-16, revised 2026-10-11:
/// no timelock; governance actions take effect as soon as two Safe owners sign).
/// @dev Required env: SAFE, OPERATOR, REVIEWER, PAUSER, COMPLIANCE_AGENT, FEE_RECIPIENT.
///      USDT is required on BSC mainnet (56). Elsewhere it is optional; when absent a TEST-ONLY MockUSDT
///      is deployed. Mainnet also requires CONFIRM_MAINNET=I_UNDERSTAND_THIS_IS_MAINNET.
contract Deploy is Script {
    uint256 internal constant BSC_MAINNET = 56;
    uint256 internal constant LOCAL_ANVIL = 31337;
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
        address admin; // the governance Safe
        IdentityRegistry identity;
        AssetRegistry assets;
        AuditRegistry audit;
        SubscriptionRouter router;
        ProjectFactory factory;
        ReferralRewards referralRewards;
        ShareMarket shareMarket;
        address usdt;
        bool usdtIsMock;
    }

    error MainnetNotConfirmed();
    error SafeNotContract(address safe);
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
        d.admin = c.safe;
        d.usdt = c.usdt;
        if (d.usdt == address(0)) {
            d.usdt = address(new MockUSDT()); // reverts on chain 56
            d.usdtIsMock = true;
        }

        d.identity = new IdentityRegistry(deployer);
        d.assets = new AssetRegistry(deployer);
        d.audit = new AuditRegistry(deployer);
        d.router = new SubscriptionRouter(IERC20(d.usdt), d.assets, c.safe, c.pauser);
        // Referrals ship switched off in both contracts; only the Safe can enable them.
        d.referralRewards = new ReferralRewards(IERC20(d.usdt), c.safe, c.operator, c.pauser);
        // Peer-to-peer resale for early exit (EARLY_EXIT_DESIGN.md); no fees, no custody.
        d.shareMarket = new ShareMarket(IERC20(d.usdt), d.assets, c.safe, c.pauser);
        d.factory = new ProjectFactory(
            d.assets,
            d.audit,
            d.identity,
            d.router,
            new TokenDeployer(),
            new OfferingDeployer(),
            new DistributorDeployer(),
            ProjectFactory.Roles({
                admin: c.safe,
                operator: c.operator,
                reviewer: c.reviewer,
                pauser: c.pauser,
                feeRecipient: c.feeRecipient
            }),
            c.safe
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
        d.identity.grantRole(admin, c.safe);
        d.assets.grantRole(admin, c.safe);
        d.audit.grantRole(admin, c.safe);
        d.identity.renounceRole(admin, deployer);
        d.assets.renounceRole(admin, deployer);
        d.audit.renounceRole(admin, deployer);

        _verify(d, c, deployer);
    }

    function _verify(Deployed memory d, Config memory c, address deployer) internal view {
        bytes32 admin = 0x00;
        _check(d.identity.hasRole(admin, c.safe), "identity admin");
        _check(d.assets.hasRole(admin, c.safe), "assets admin");
        _check(d.audit.hasRole(admin, c.safe), "audit admin");
        _check(d.router.hasRole(admin, c.safe), "router admin");
        _check(d.factory.hasRole(admin, c.safe), "factory admin");
        _check(!d.identity.hasRole(admin, deployer), "identity deployer renounced");
        _check(!d.assets.hasRole(admin, deployer), "assets deployer renounced");
        _check(!d.audit.hasRole(admin, deployer), "audit deployer renounced");
        _check(!d.router.hasRole(admin, deployer) || deployer == c.safe, "router deployer");
        _check(!d.factory.hasRole(admin, deployer) || deployer == c.safe, "factory deployer");
        _check(d.referralRewards.hasRole(admin, c.safe), "referral admin");
        _check(!d.referralRewards.hasRole(admin, deployer) || deployer == c.safe, "referral deployer");
        _check(d.referralRewards.hasRole(d.referralRewards.ROOT_SETTER_ROLE(), c.operator), "referral root setter");
        _check(address(d.referralRewards.paymentToken()) == d.usdt, "referral usdt");
        _check(!d.router.referralsEnabled() && !d.referralRewards.claimsEnabled(), "referrals start disabled");
        _check(d.shareMarket.hasRole(admin, c.safe), "market admin");
        _check(!d.shareMarket.hasRole(admin, deployer) || deployer == c.safe, "market deployer");
        _check(address(d.shareMarket.usdt()) == d.usdt, "market usdt");
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
        // Admin goes straight to SAFE, so it must be the deployed multisig, not an EOA (anvil excepted).
        if (block.chainid != LOCAL_ANVIL && c.safe.code.length == 0) revert SafeNotContract(c.safe);
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
        console2.log("Admin (Safe)      ", d.admin);
        console2.log("IdentityRegistry  ", address(d.identity));
        console2.log("AssetRegistry     ", address(d.assets));
        console2.log("AuditRegistry     ", address(d.audit));
        console2.log("SubscriptionRouter", address(d.router));
        console2.log("ProjectFactory    ", address(d.factory));
        console2.log("ReferralRewards   ", address(d.referralRewards));
        console2.log("ShareMarket       ", address(d.shareMarket));
        console2.log("USDT              ", d.usdt);
    }
}
