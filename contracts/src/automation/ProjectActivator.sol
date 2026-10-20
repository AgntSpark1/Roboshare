// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AssetRegistry} from "../registry/AssetRegistry.sol";
import {ProjectState} from "../interfaces/IRoboShare.sol";

/// @title ProjectActivator
/// @notice Lets the matchmaker put a funded vehicle into service without a Safe signature (MATCHMAKER_DESIGN.md;
/// Charlene 2026-10-20: testnet and mainnet both start automatically once full). Governance grants this contract
/// DEFAULT_ADMIN_ROLE on the AssetRegistry; the only thing it can do with it is move a FUNDED project to ACTIVE.
/// It has no other call into the registry, so a server key holding ACTIVATOR_ROLE cannot grant roles, cancel,
/// terminate or suspend anything. Governance revokes either role to switch it off. On the pre-mainnet audit and
/// legal review list.
contract ProjectActivator is AccessControl {
    bytes32 public constant ACTIVATOR_ROLE = keccak256("ACTIVATOR_ROLE");
    /// @notice Same reason hash the worker uses for a Safe activation proposal.
    bytes32 public constant REASON = keccak256("roboshare:matchmaker:in-service");

    AssetRegistry public immutable assetRegistry;

    event Activated(bytes32 indexed projectId, address indexed by);

    error ZeroValue();
    error NotFunded(ProjectState state);

    constructor(AssetRegistry assetRegistry_, address admin) {
        if (address(assetRegistry_) == address(0) || admin == address(0)) revert ZeroValue();
        assetRegistry = assetRegistry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function activate(bytes32 projectId) external onlyRole(ACTIVATOR_ROLE) {
        ProjectState s = assetRegistry.stateOf(projectId);
        if (s != ProjectState.FUNDED) revert NotFunded(s);
        assetRegistry.transition(projectId, ProjectState.ACTIVE, REASON);
        emit Activated(projectId, msg.sender);
    }
}
