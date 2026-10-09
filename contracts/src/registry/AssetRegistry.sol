// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAssetRegistry, IRevenueDistributor, ProjectState} from "../interfaces/IRoboShare.sol";

/// @title AssetRegistry
/// @notice Project and asset identity plus the project lifecycle state machine.
/// A state change records an attestation by an authorized role. It does not prove that a vehicle
/// was purchased, insured, licensed or put into service.
contract AssetRegistry is IAssetRegistry, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    struct Project {
        bytes32 assetId; // keccak256(abi.encode(VIN, salt)); VIN and salt stay off-chain
        bytes32 issuerId;
        bytes32 rightsDocHash;
        ProjectState state;
        address registrant;
        address token;
        address offering;
        address distributor;
        uint64 createdAt;
        uint64 fundedAtBlock;
    }

    mapping(bytes32 => Project) private _projects;
    mapping(bytes32 => bytes32) public assetToProject; // never cleared

    event ProjectRegistered(
        bytes32 indexed projectId, bytes32 indexed assetId, bytes32 issuerId, bytes32 rightsDocHash, address registrant
    );
    event DraftUpdated(bytes32 indexed projectId, bytes32 issuerId, bytes32 rightsDocHash);
    event ProjectStateChanged(
        bytes32 indexed projectId, ProjectState from, ProjectState to, bytes32 reasonHash, address indexed actor
    );
    event ProjectContractsLinked(bytes32 indexed projectId, address token, address offering, address distributor);

    error ZeroValue();
    error ProjectExists(bytes32 projectId);
    error AssetAlreadyRegistered(bytes32 assetId);
    error UnknownProject(bytes32 projectId);
    error InvalidTransition(ProjectState from, ProjectState to);
    error Unauthorized(address caller);
    error SelfApproval();
    error AlreadyLinked(bytes32 projectId);
    error NotLinked(bytes32 projectId);
    error PendingDistribution();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroValue();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function registerProject(bytes32 projectId, bytes32 assetId, bytes32 issuerId, bytes32 rightsDocHash)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (projectId == 0 || assetId == 0 || issuerId == 0 || rightsDocHash == 0) revert ZeroValue();
        if (_projects[projectId].state != ProjectState.NONE) revert ProjectExists(projectId);
        if (assetToProject[assetId] != 0) revert AssetAlreadyRegistered(assetId);

        Project storage p = _projects[projectId];
        p.assetId = assetId;
        p.issuerId = issuerId;
        p.rightsDocHash = rightsDocHash;
        p.state = ProjectState.DRAFT;
        p.registrant = msg.sender;
        p.createdAt = uint64(block.timestamp);
        assetToProject[assetId] = projectId;

        emit ProjectRegistered(projectId, assetId, issuerId, rightsDocHash, msg.sender);
        emit ProjectStateChanged(projectId, ProjectState.NONE, ProjectState.DRAFT, rightsDocHash, msg.sender);
    }

    function updateDraft(bytes32 projectId, bytes32 issuerId, bytes32 rightsDocHash)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Project storage p = _existing(projectId);
        if (p.state != ProjectState.DRAFT) revert InvalidTransition(p.state, ProjectState.DRAFT);
        if (issuerId == 0 || rightsDocHash == 0) revert ZeroValue();
        p.issuerId = issuerId;
        p.rightsDocHash = rightsDocHash;
        emit DraftUpdated(projectId, issuerId, rightsDocHash);
    }

    // ---------------------------------------------------------------------
    // Lifecycle (role-driven transitions)
    // ---------------------------------------------------------------------

    /// @notice Role-driven transitions. Offering-driven transitions use the mark* hooks instead.
    function transition(bytes32 projectId, ProjectState to, bytes32 reasonHash) external {
        if (reasonHash == 0) revert ZeroValue();
        Project storage p = _existing(projectId);
        ProjectState from = p.state;
        _authorizeTransition(p, from, to);
        p.state = to;
        emit ProjectStateChanged(projectId, from, to, reasonHash, msg.sender);
    }

    function _authorizeTransition(Project storage p, ProjectState from, ProjectState to) private view {
        bool admin = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);

        if (from == ProjectState.DRAFT && to == ProjectState.VERIFIED) {
            if (!hasRole(REVIEWER_ROLE, msg.sender)) revert Unauthorized(msg.sender);
            if (msg.sender == p.registrant) revert SelfApproval();
            return;
        }
        if (from == ProjectState.DRAFT && to == ProjectState.CANCELLED) {
            if (!admin && !hasRole(OPERATOR_ROLE, msg.sender)) revert Unauthorized(msg.sender);
            return;
        }
        if (from == ProjectState.VERIFIED && to == ProjectState.DRAFT) {
            if (!hasRole(REVIEWER_ROLE, msg.sender)) revert Unauthorized(msg.sender);
            return;
        }
        if (from == ProjectState.ACTIVE && to == ProjectState.SUSPENDED) {
            if (!admin && !hasRole(PAUSER_ROLE, msg.sender)) revert Unauthorized(msg.sender);
            return;
        }

        bool adminOnly = (from == ProjectState.VERIFIED && to == ProjectState.CANCELLED)
            || (from == ProjectState.FUNDED && to == ProjectState.ACTIVE)
            || (from == ProjectState.SUSPENDED && to == ProjectState.ACTIVE)
            || (
                to == ProjectState.TERMINATED
                    && (from == ProjectState.FUNDED || from == ProjectState.ACTIVE || from == ProjectState.SUSPENDED)
            ) || (to == ProjectState.EXIT_PENDING && (from == ProjectState.ACTIVE || from == ProjectState.SUSPENDED));

        if (adminOnly) {
            if (!admin) revert Unauthorized(msg.sender);
            return;
        }

        if (to == ProjectState.CLOSED && (from == ProjectState.EXIT_PENDING || from == ProjectState.TERMINATED)) {
            if (!admin) revert Unauthorized(msg.sender);
            if (p.distributor != address(0) && IRevenueDistributor(p.distributor).hasPendingBatch()) {
                revert PendingDistribution();
            }
            return;
        }

        revert InvalidTransition(from, to);
    }

    // ---------------------------------------------------------------------
    // Factory / offering hooks
    // ---------------------------------------------------------------------

    function linkContracts(bytes32 projectId, address token, address offering, address distributor)
        external
        onlyRole(FACTORY_ROLE)
    {
        Project storage p = _existing(projectId);
        if (p.state != ProjectState.VERIFIED) revert InvalidTransition(p.state, ProjectState.VERIFIED);
        if (p.token != address(0)) revert AlreadyLinked(projectId);
        if (token == address(0) || offering == address(0) || distributor == address(0)) revert ZeroValue();
        p.token = token;
        p.offering = offering;
        p.distributor = distributor;
        emit ProjectContractsLinked(projectId, token, offering, distributor);
    }

    function markOffering(bytes32 projectId, bytes32 reasonHash) external {
        _offeringTransition(projectId, ProjectState.VERIFIED, ProjectState.OFFERING, reasonHash);
    }

    function markFunded(bytes32 projectId, bytes32 reasonHash) external {
        _offeringTransition(projectId, ProjectState.OFFERING, ProjectState.FUNDED, reasonHash);
        _projects[projectId].fundedAtBlock = uint64(block.number);
    }

    function markCancelled(bytes32 projectId, bytes32 reasonHash) external {
        _offeringTransition(projectId, ProjectState.OFFERING, ProjectState.CANCELLED, reasonHash);
    }

    function _offeringTransition(bytes32 projectId, ProjectState from, ProjectState to, bytes32 reasonHash) private {
        Project storage p = _existing(projectId);
        if (p.offering == address(0)) revert NotLinked(projectId);
        if (msg.sender != p.offering) revert Unauthorized(msg.sender);
        if (p.state != from) revert InvalidTransition(p.state, to);
        p.state = to;
        emit ProjectStateChanged(projectId, from, to, reasonHash, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getProject(bytes32 projectId) external view returns (Project memory) {
        return _projects[projectId];
    }

    function stateOf(bytes32 projectId) external view returns (ProjectState) {
        return _projects[projectId].state;
    }

    function offeringOf(bytes32 projectId) external view returns (address) {
        return _projects[projectId].offering;
    }

    function fundedAtBlock(bytes32 projectId) external view returns (uint64) {
        return _projects[projectId].fundedAtBlock;
    }

    function _existing(bytes32 projectId) private view returns (Project storage p) {
        p = _projects[projectId];
        if (p.state == ProjectState.NONE) revert UnknownProject(projectId);
    }
}
