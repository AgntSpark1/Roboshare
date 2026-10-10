// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Project lifecycle states. Each state is an attestation by an authorized role,
/// not proof of any real-world event.
enum ProjectState {
    NONE,
    DRAFT,
    VERIFIED,
    OFFERING,
    FUNDED,
    ACTIVE,
    SUSPENDED,
    EXIT_PENDING,
    TERMINATED,
    CLOSED,
    CANCELLED
}

enum RecordKind {
    DOCUMENT,
    FINANCIAL_REPORT,
    EVIDENCE,
    ATTESTATION
}

enum RecordStatus {
    NONE,
    SUBMITTED,
    APPROVED,
    REJECTED,
    SUPERSEDED
}

struct AuditRecord {
    bytes32 projectId;
    RecordKind kind;
    RecordStatus status;
    bytes32 contentHash;
    bytes32 docType;
    bytes32 offchainRef;
    uint32 version;
    bytes32 supersedes;
    uint64 periodStart;
    uint64 periodEnd;
    uint256 distributableAmount;
    address paymentToken;
    address submitter;
    address reviewer;
    uint64 submittedAt;
    uint64 reviewedAt;
}

interface IIdentityRegistry {
    function isEligible(address wallet) external view returns (bool);
    function isFrozen(address wallet) external view returns (bool);
    function classOf(address wallet) external view returns (uint16);
}

interface IAssetRegistry {
    function stateOf(bytes32 projectId) external view returns (ProjectState);
    function offeringOf(bytes32 projectId) external view returns (address);
    function fundedAtBlock(bytes32 projectId) external view returns (uint64);
    function markOffering(bytes32 projectId, bytes32 reasonHash) external;
    function markFunded(bytes32 projectId, bytes32 reasonHash) external;
    function markCancelled(bytes32 projectId, bytes32 reasonHash) external;
    function linkContracts(bytes32 projectId, address token, address offering, address distributor) external;
}

interface IAuditRegistry {
    function getRecord(bytes32 recordId) external view returns (AuditRecord memory);
}

interface IRwaShareToken {
    function mint(address to, uint256 units) external;
    function bindMinter(address minter) external;
    function isClassAllowed(uint16 investorClass) external view returns (bool);
    function balanceOfAt(address account, uint256 blockNumber) external view returns (uint256);
    function totalSupplyAt(uint256 blockNumber) external view returns (uint256);
    function CAP() external view returns (uint256);
}

interface IOfferingManager {
    function quote(uint32 units) external view returns (uint256);
    function subscribeFor(address investor, uint32 units, uint256 cost) external;
}

interface IRevenueDistributor {
    function hasPendingBatch() external view returns (bool);
}

interface ISubscriptionRouter {
    function USDT() external view returns (address);
}
