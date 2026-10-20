// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {ProjectActivator} from "../src/automation/ProjectActivator.sol";

/// @notice Deploys the ProjectActivator (automatic "start operating" after a fill). Admin goes to
/// the Safe; nothing works until the Safe grants it DEFAULT_ADMIN_ROLE on the AssetRegistry and grants
/// ACTIVATOR_ROLE to the matchmaker launcher (the console's 撮合 page prepares both).
/// @dev Required env: ASSET_REGISTRY, SAFE. The contract itself refuses BSC mainnet.
contract DeployActivator is Script {
    error MissingAddress(string name);

    function run() external returns (ProjectActivator a) {
        address registry = vm.envOr("ASSET_REGISTRY", address(0));
        address safe = vm.envOr("SAFE", address(0));
        if (registry == address(0)) revert MissingAddress("ASSET_REGISTRY");
        if (safe == address(0)) revert MissingAddress("SAFE");
        vm.startBroadcast();
        a = new ProjectActivator(AssetRegistry(registry), safe);
        vm.stopBroadcast();
        console2.log("ProjectActivator", address(a));
    }
}
