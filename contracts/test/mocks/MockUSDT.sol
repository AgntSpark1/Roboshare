// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST-ONLY. Stand-in for USDT (BEP20) in tests and on BSC testnet, where no official
/// USDT exists. Anyone can mint. Never deploy to chain 56.
contract MockUSDT is ERC20 {
    constructor() ERC20("TEST-ONLY Mock USDT", "tUSDT") {
        require(block.chainid != 56, "MockUSDT: TEST-ONLY");
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice TEST-ONLY. Takes a 1% fee on every transfer, to prove contracts reject such tokens.
contract MockFeeOnTransferToken is ERC20 {
    constructor() ERC20("TEST-ONLY Fee Token", "tFEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xdead), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

interface IReentryTarget {
    function reenter() external;
}

/// @notice TEST-ONLY. Calls back into an attacker hook on every transfer to test reentrancy guards.
contract MockReentrantToken is ERC20 {
    address public hook;

    constructor() ERC20("TEST-ONLY Reentrant Token", "tRE") {}

    function setHook(address hook_) external {
        hook = hook_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hook != address(0) && from != address(0) && to != address(0)) {
            IReentryTarget(hook).reenter();
        }
    }
}
