// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AssetRegistry} from "../src/registry/AssetRegistry.sol";
import {ShareMarket} from "../src/market/ShareMarket.sol";

/// @notice Adds the ShareMarket (EARLY_EXIT_DESIGN.md) to an existing deployment. Admin goes straight
/// to the timelock; the deployer never holds a role.
/// @dev Required env: ASSET_REGISTRY, PAYMENT_TOKEN, TIMELOCK, PAUSER (the addresses in deployments/*.env).
///      BSC mainnet also requires CONFIRM_MAINNET=I_UNDERSTAND_THIS_IS_MAINNET.
contract DeployShareMarket is Script {
    uint256 internal constant BSC_MAINNET = 56;
    bytes32 internal constant MAINNET_CONFIRMATION = keccak256("I_UNDERSTAND_THIS_IS_MAINNET");

    error MainnetNotConfirmed();
    error MissingAddress(string name);
    error CheckFailed(string what);

    function run() external returns (ShareMarket market) {
        if (
            block.chainid == BSC_MAINNET
                && keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) != MAINNET_CONFIRMATION
        ) revert MainnetNotConfirmed();
        address assets = _required("ASSET_REGISTRY");
        address usdt = _required("PAYMENT_TOKEN");
        address timelock = _required("TIMELOCK");
        address pauser = _required("PAUSER");

        vm.startBroadcast();
        market = deploy(usdt, assets, timelock, pauser);
        vm.stopBroadcast();
        console2.log("ShareMarket", address(market));
    }

    function deploy(address usdt, address assets, address timelock, address pauser)
        public
        returns (ShareMarket market)
    {
        market = new ShareMarket(IERC20(usdt), AssetRegistry(assets), timelock, pauser);
        if (!market.hasRole(0x00, timelock)) revert CheckFailed("timelock admin");
        if (market.hasRole(0x00, msg.sender) && msg.sender != timelock) revert CheckFailed("deployer admin");
        if (address(market.usdt()) != usdt || address(market.assetRegistry()) != assets) {
            revert CheckFailed("wiring");
        }
    }

    function _required(string memory name) internal view returns (address a) {
        a = vm.envOr(name, address(0));
        if (a == address(0)) revert MissingAddress(name);
    }
}
