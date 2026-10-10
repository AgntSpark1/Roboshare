// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAssetRegistry, IOfferingManager, ISubscriptionRouter} from "../interfaces/IRoboShare.sol";

/// @title SubscriptionRouter
/// @notice Single entry point investors approve USDT to once (D-23). Each call pulls exactly
/// `quote(units)` from the caller and sends it straight to the project's linked OfferingManager.
/// The router never pulls from anyone but `msg.sender`, never holds funds, and has no withdrawal
/// or admin transfer function. Governance can only pause/unpause.
contract SubscriptionRouter is ISubscriptionRouter, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 private immutable _usdt;
    IAssetRegistry public immutable assetRegistry;

    event RoutedSubscription(
        bytes32 indexed projectId, address indexed investor, address indexed offering, uint32 units, uint256 cost
    );

    error ZeroValue();
    error OfferingNotLinked(bytes32 projectId);
    error CostAboveMax(uint256 cost, uint256 maxCost);

    constructor(IERC20 usdt_, IAssetRegistry assetRegistry_, address admin, address pauser) {
        if (address(usdt_) == address(0) || address(assetRegistry_) == address(0) || admin == address(0)) {
            revert ZeroValue();
        }
        _usdt = usdt_;
        assetRegistry = assetRegistry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
    }

    function USDT() external view returns (address) {
        return address(_usdt);
    }

    /// @param maxCost Upper bound the investor accepts; protects against a wrong project or price.
    function subscribe(bytes32 projectId, uint32 units, uint256 maxCost) external nonReentrant whenNotPaused {
        if (units == 0) revert ZeroValue();
        address offering = assetRegistry.offeringOf(projectId);
        if (offering == address(0)) revert OfferingNotLinked(projectId);

        uint256 cost = IOfferingManager(offering).quote(units);
        if (cost == 0) revert ZeroValue();
        if (cost > maxCost) revert CostAboveMax(cost, maxCost);

        _usdt.safeTransferFrom(msg.sender, offering, cost);
        IOfferingManager(offering).subscribeFor(msg.sender, units, cost);
        emit RoutedSubscription(projectId, msg.sender, offering, units, cost);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
