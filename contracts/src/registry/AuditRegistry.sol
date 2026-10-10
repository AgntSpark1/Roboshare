// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAuditRegistry, AuditRecord, RecordKind, RecordStatus} from "../interfaces/IRoboShare.sol";

/// @title AuditRegistry
/// @notice Append-only registry of document and report hashes with a two-person review.
/// A matching hash proves a file is byte-identical to what was anchored; it does not prove the
/// document is authentic or truthful.
contract AuditRegistry is IAuditRegistry, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    struct RecordInput {
        bytes32 projectId;
        RecordKind kind;
        bytes32 contentHash;
        bytes32 docType;
        bytes32 offchainRef;
        uint64 periodStart;
        uint64 periodEnd;
        uint256 distributableAmount;
        address paymentToken;
    }

    mapping(bytes32 => AuditRecord) private _records;
    mapping(bytes32 => mapping(bytes32 => uint32)) public latestVersion; // projectId => docType => version
    mapping(bytes32 => mapping(bytes32 => bytes32)) public activeReportForPeriod; // projectId => periodKey => recordId
    mapping(bytes32 => uint64) public lastApprovedPeriodEnd; // projectId => end of the latest approved period

    event RecordSubmitted(
        bytes32 indexed recordId,
        bytes32 indexed projectId,
        RecordKind kind,
        bytes32 contentHash,
        bytes32 docType,
        uint32 version,
        bytes32 supersedes,
        address submitter
    );
    event RecordApproved(bytes32 indexed recordId, bytes32 indexed projectId, address reviewer);
    event RecordRejected(bytes32 indexed recordId, bytes32 indexed projectId, bytes32 reasonHash, address reviewer);
    event RecordSuperseded(bytes32 indexed recordId, bytes32 indexed supersededBy);

    error ZeroValue();
    error DuplicateRecord(bytes32 recordId);
    error UnknownRecord(bytes32 recordId);
    error InvalidPeriod();
    error InvalidReportFields();
    error NotSubmitted(bytes32 recordId);
    error SelfApproval();
    error PeriodAlreadyApproved(bytes32 projectId, bytes32 periodKey);
    error PeriodOverlapsApproved(bytes32 projectId, uint64 periodStart, uint64 lastApprovedEnd);
    error InvalidAmendment(bytes32 previous);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroValue();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function submitRecord(RecordInput calldata input) external onlyRole(OPERATOR_ROLE) returns (bytes32) {
        return _submit(input, 0);
    }

    /// @notice Submits a new version of an approved record. The previous record becomes SUPERSEDED
    /// when the amendment is approved. Reports must keep the same period.
    function submitAmendment(bytes32 previousId, RecordInput calldata input)
        external
        onlyRole(OPERATOR_ROLE)
        returns (bytes32)
    {
        AuditRecord storage prev = _records[previousId];
        if (prev.status != RecordStatus.APPROVED) revert InvalidAmendment(previousId);
        if (prev.projectId != input.projectId || prev.kind != input.kind || prev.docType != input.docType) {
            revert InvalidAmendment(previousId);
        }
        if (
            input.kind == RecordKind.FINANCIAL_REPORT
                && (prev.periodStart != input.periodStart || prev.periodEnd != input.periodEnd)
        ) revert InvalidAmendment(previousId);
        return _submit(input, previousId);
    }

    function approve(bytes32 recordId) external onlyRole(REVIEWER_ROLE) {
        AuditRecord storage r = _submitted(recordId);
        if (msg.sender == r.submitter) revert SelfApproval();

        if (r.kind == RecordKind.FINANCIAL_REPORT) {
            bytes32 key = periodKey(r.periodStart, r.periodEnd);
            bytes32 active = activeReportForPeriod[r.projectId][key];
            if (r.supersedes == 0) {
                if (active != 0) revert PeriodAlreadyApproved(r.projectId, key);
                uint64 lastEnd = lastApprovedPeriodEnd[r.projectId];
                if (r.periodStart < lastEnd) revert PeriodOverlapsApproved(r.projectId, r.periodStart, lastEnd);
                lastApprovedPeriodEnd[r.projectId] = r.periodEnd;
            } else if (active != r.supersedes) {
                revert InvalidAmendment(r.supersedes);
            }
            activeReportForPeriod[r.projectId][key] = recordId;
        }

        if (r.supersedes != 0) {
            AuditRecord storage prev = _records[r.supersedes];
            if (prev.status != RecordStatus.APPROVED) revert InvalidAmendment(r.supersedes);
            prev.status = RecordStatus.SUPERSEDED;
            emit RecordSuperseded(r.supersedes, recordId);
        }

        r.status = RecordStatus.APPROVED;
        r.reviewer = msg.sender;
        r.reviewedAt = uint64(block.timestamp);
        emit RecordApproved(recordId, r.projectId, msg.sender);
    }

    function reject(bytes32 recordId, bytes32 reasonHash) external onlyRole(REVIEWER_ROLE) {
        if (reasonHash == 0) revert ZeroValue();
        AuditRecord storage r = _submitted(recordId);
        if (msg.sender == r.submitter) revert SelfApproval();
        r.status = RecordStatus.REJECTED;
        r.reviewer = msg.sender;
        r.reviewedAt = uint64(block.timestamp);
        emit RecordRejected(recordId, r.projectId, reasonHash, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getRecord(bytes32 recordId) external view returns (AuditRecord memory) {
        return _records[recordId];
    }

    /// @notice True when the record exists, is not rejected, and its anchored hash equals `contentHash`.
    function verify(bytes32 recordId, bytes32 contentHash) external view returns (bool) {
        AuditRecord storage r = _records[recordId];
        return r.status != RecordStatus.NONE && r.status != RecordStatus.REJECTED && r.contentHash == contentHash;
    }

    function computeRecordId(bytes32 projectId, RecordKind kind, bytes32 contentHash) public pure returns (bytes32) {
        return keccak256(abi.encode(projectId, kind, contentHash));
    }

    function periodKey(uint64 periodStart, uint64 periodEnd) public pure returns (bytes32) {
        return keccak256(abi.encode(periodStart, periodEnd));
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _submit(RecordInput calldata input, bytes32 supersedes) private returns (bytes32 recordId) {
        if (input.projectId == 0 || input.contentHash == 0 || input.docType == 0) revert ZeroValue();
        if (input.kind == RecordKind.FINANCIAL_REPORT) {
            if (input.periodEnd <= input.periodStart) revert InvalidPeriod();
            if (input.paymentToken == address(0)) revert InvalidReportFields();
        } else if (
            input.periodStart != 0 || input.periodEnd != 0 || input.distributableAmount != 0
                || input.paymentToken != address(0)
        ) {
            revert InvalidReportFields();
        }

        recordId = computeRecordId(input.projectId, input.kind, input.contentHash);
        if (_records[recordId].status != RecordStatus.NONE) revert DuplicateRecord(recordId);

        uint32 version = ++latestVersion[input.projectId][input.docType];
        _records[recordId] = AuditRecord({
            projectId: input.projectId,
            kind: input.kind,
            status: RecordStatus.SUBMITTED,
            contentHash: input.contentHash,
            docType: input.docType,
            offchainRef: input.offchainRef,
            version: version,
            supersedes: supersedes,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            distributableAmount: input.distributableAmount,
            paymentToken: input.paymentToken,
            submitter: msg.sender,
            reviewer: address(0),
            submittedAt: uint64(block.timestamp),
            reviewedAt: 0
        });
        emit RecordSubmitted(
            recordId, input.projectId, input.kind, input.contentHash, input.docType, version, supersedes, msg.sender
        );
    }

    function _submitted(bytes32 recordId) private view returns (AuditRecord storage r) {
        r = _records[recordId];
        if (r.status == RecordStatus.NONE) revert UnknownRecord(recordId);
        if (r.status != RecordStatus.SUBMITTED) revert NotSubmitted(recordId);
    }
}
