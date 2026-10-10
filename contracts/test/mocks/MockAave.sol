// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice TEST-ONLY stand-ins for the Aave V3 read interfaces used by the worker's Aave reader.
/// They hold whatever values a test sets and implement no lending logic.
contract MockPoolAddressesProvider {
    address public pool;
    address public oracle;
    address public dataProvider;

    constructor(address pool_, address oracle_, address dataProvider_) {
        (pool, oracle, dataProvider) = (pool_, oracle_, dataProvider_);
    }

    function setPool(address pool_) external {
        pool = pool_;
    }

    function getPool() external view returns (address) {
        return pool;
    }

    function getPriceOracle() external view returns (address) {
        return oracle;
    }

    function getPoolDataProvider() external view returns (address) {
        return dataProvider;
    }
}

contract MockAavePool {}

contract MockAaveOracle {
    mapping(address => uint256) public prices;

    function setPrice(address asset, uint256 price) external {
        prices[asset] = price;
    }

    function BASE_CURRENCY_UNIT() external pure returns (uint256) {
        return 1e8;
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return prices[asset];
    }
}

contract MockPoolDataProvider {
    struct TokenData {
        string symbol;
        address tokenAddress;
    }

    TokenData[] internal _tokens;
    mapping(address => uint256) public decimalsOf;

    function addReserve(string calldata symbol, address token, uint256 decimals) external {
        _tokens.push(TokenData(symbol, token));
        decimalsOf[token] = decimals;
    }

    function getAllReservesTokens() external view returns (TokenData[] memory) {
        return _tokens;
    }

    function getReserveConfigurationData(address asset)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, bool, bool, bool, bool, bool)
    {
        return (decimalsOf[asset], 7500, 8000, 10500, 1000, true, true, false, true, false);
    }

    function getReserveCaps(address) external pure returns (uint256, uint256) {
        return (1_000_000, 2_000_000);
    }

    function getPaused(address) external pure returns (bool) {
        return false;
    }

    function getReserveData(address)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint40)
    {
        // 5% supply APR and 8% variable borrow APR, in ray.
        return (0, 0, 1_000_000e18, 0, 600_000e18, 5e25, 8e25, 0, 0, 1e27, 1e27, uint40(block.timestamp));
    }
}
