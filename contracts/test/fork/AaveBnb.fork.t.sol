// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
    function getPriceOracle() external view returns (address);
    function getPoolDataProvider() external view returns (address);
}

interface IPoolDataProvider {
    function getReserveConfigurationData(address asset)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, bool, bool, bool, bool, bool);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @notice Cross-checks the Aave V3 BNB addresses in packages/shared/src/aave.ts and the platform USDT
/// against BSC mainnet state. Run with: BSC_RPC_URL=... forge test --match-path test/fork/*
/// Skipped when BSC_RPC_URL is not set.
contract AaveBnbForkTest is Test {
    address constant PROVIDER = 0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D;
    address constant POOL = 0x6807dc923806fE8Fd134338EABCA509979a7e0cB;
    address constant ORACLE = 0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697;
    address constant DATA_PROVIDER = 0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;

    function setUp() public {
        string memory rpc = vm.envOr("BSC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    function test_ChainIsBscMainnet() public view {
        assertEq(block.chainid, 56);
    }

    function test_ProviderPointsAtExpectedContracts() public view {
        IPoolAddressesProvider p = IPoolAddressesProvider(PROVIDER);
        assertEq(p.getPool(), POOL);
        assertEq(p.getPriceOracle(), ORACLE);
        assertEq(p.getPoolDataProvider(), DATA_PROVIDER);
    }

    function test_UsdtIsAnAaveReserveWith18Decimals() public view {
        assertEq(IERC20Decimals(USDT).decimals(), 18);
        (uint256 decimals,,,,,,,, bool isActive,) = IPoolDataProvider(DATA_PROVIDER).getReserveConfigurationData(USDT);
        assertEq(decimals, 18);
        assertTrue(isActive);
    }
}
