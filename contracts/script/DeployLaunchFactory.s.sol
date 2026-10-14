// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {AuditRegistry} from "../src/registry/AuditRegistry.sol";
import {IdentityRegistry} from "../src/identity/IdentityRegistry.sol";
import {SubscriptionRouter} from "../src/offering/SubscriptionRouter.sol";
import {
    ProjectFactory, TokenDeployer, OfferingDeployer, DistributorDeployer
} from "../src/factory/ProjectFactory.sol";

/// @notice Adds a ProjectFactory with automatic listing (`launch`, MATCHMAKER_DESIGN.md) to an existing
/// deployment. It reuses the existing deployers and copies the old factory's roles. Admin goes straight to
/// the governance Safe; the deployer never holds a role. Nothing works until the Safe grants the new factory
/// FACTORY_ROLE on the AssetRegistry and sets a launch template (admin console 撮合 page prepares both).
/// @dev Required env: OLD_FACTORY, SAFE (the addresses in deployments/*.env).
///      BSC mainnet also requires CONFIRM_MAINNET=I_UNDERSTAND_THIS_IS_MAINNET.
contract DeployLaunchFactory is Script {
    uint256 internal constant BSC_MAINNET = 56;
    bytes32 internal constant MAINNET_CONFIRMATION = keccak256("I_UNDERSTAND_THIS_IS_MAINNET");

    error MainnetNotConfirmed();
    error MissingAddress(string name);
    error CheckFailed(string what);

    function run() external returns (ProjectFactory factory) {
        if (
            block.chainid == BSC_MAINNET
                && keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) != MAINNET_CONFIRMATION
        ) revert MainnetNotConfirmed();
        ProjectFactory old = ProjectFactory(_required("OLD_FACTORY"));
        address safe = _required("SAFE");

        vm.startBroadcast();
        factory = deploy(old, safe);
        vm.stopBroadcast();
        console2.log("ProjectFactory (launch)", address(factory));
    }

    function deploy(ProjectFactory old, address safe) public returns (ProjectFactory factory) {
        (address admin, address operator, address reviewer, address pauser, address feeRecipient) = old.roles();
        if (admin != safe) revert CheckFailed("old factory admin is not SAFE");
        factory = new ProjectFactory(
            old.assetRegistry(),
            old.auditRegistry(),
            old.identityRegistry(),
            old.router(),
            old.tokenDeployer(),
            old.offeringDeployer(),
            old.distributorDeployer(),
            ProjectFactory.Roles({
                admin: admin, operator: operator, reviewer: reviewer, pauser: pauser, feeRecipient: feeRecipient
            }),
            safe
        );
        if (!factory.hasRole(0x00, safe)) revert CheckFailed("safe admin");
        if (factory.hasRole(0x00, msg.sender) && msg.sender != safe) revert CheckFailed("deployer admin");
        (bool enabled,,,,,,,,) = factory.launchTemplate();
        if (enabled) revert CheckFailed("template must start disabled");
    }

    function _required(string memory name) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) revert MissingAddress(name);
    }
}
