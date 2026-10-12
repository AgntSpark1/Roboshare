// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IIdentityRegistry} from "../interfaces/IRoboShare.sol";

/// @title IdentityRegistry
/// @notice Freeze list only. RoboShare performs no KYC/AML and keeps no eligibility or investor-class data
/// (owner decision, 2026-10-11). Any wallet that is not frozen may subscribe, hold and receive units.
/// The compliance agent freezes a stolen or sanctioned wallet; only governance can unfreeze it.
/// Stores no personal data.
contract IdentityRegistry is IIdentityRegistry, AccessControl, Pausable {
    bytes32 public constant COMPLIANCE_AGENT_ROLE = keccak256("COMPLIANCE_AGENT_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    mapping(address => bool) private _frozen;

    event WalletFrozen(address indexed wallet, bytes32 reasonCode, address indexed agent);
    event WalletUnfrozen(address indexed wallet, address indexed admin);

    error ZeroAddress();
    error WalletIsFrozen(address wallet);
    error WalletNotFrozen(address wallet);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Blocks a wallet from subscribing, being settled to, and receiving or sending units.
    function freeze(address wallet, bytes32 reasonCode) external onlyRole(COMPLIANCE_AGENT_ROLE) whenNotPaused {
        if (wallet == address(0)) revert ZeroAddress();
        if (_frozen[wallet]) revert WalletIsFrozen(wallet);
        _frozen[wallet] = true;
        emit WalletFrozen(wallet, reasonCode, msg.sender);
    }

    /// @notice Only governance can lift a freeze.
    function unfreeze(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_frozen[wallet]) revert WalletNotFrozen(wallet);
        _frozen[wallet] = false;
        emit WalletUnfrozen(wallet, msg.sender);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function isFrozen(address wallet) public view returns (bool) {
        return _frozen[wallet];
    }
}
