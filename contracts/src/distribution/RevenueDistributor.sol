// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    IAssetRegistry,
    IAuditRegistry,
    IIdentityRegistry,
    IRevenueDistributor,
    IRwaShareToken,
    AuditRecord,
    ProjectState,
    RecordKind,
    RecordStatus
} from "../interfaces/IRoboShare.sol";
import {FeeTiers} from "../libraries/FeeTiers.sol";

/// @title RevenueDistributor
/// @notice Distributes approved project profit for one project. Allocations are computed on-chain
/// at proposal from snapshot balances and the immutable fee tiers, then claimed by holders (pull).
///
///   gross_i = floor(D * u_i / U)
///   fee_i   = floor(gross_i * tierBps(u_i) / 10_000)
///   net_i   = gross_i - fee_i
///   dust    = D - sum(gross_i)   (carried into the next batch)
contract RevenueDistributor is IRevenueDistributor, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant MAX_HOLDERS = 100;

    enum BatchStatus {
        NONE,
        PROPOSED,
        CLAIMABLE,
        REJECTED
    }

    struct Batch {
        bytes32 reportId;
        uint256 amount; // newly funded from the treasury
        uint256 carriedDustIn;
        uint256 pool; // amount + carriedDustIn
        uint256 totalNet;
        uint256 totalFee;
        uint256 dustOut;
        uint64 snapshotBlock;
        address proposer;
        address approver;
        BatchStatus status;
    }

    struct Allocation {
        uint128 net;
        uint16 feeBps;
        bool claimed;
    }

    struct Params {
        bytes32 projectId;
        IAssetRegistry assetRegistry;
        IAuditRegistry auditRegistry;
        IIdentityRegistry identityRegistry;
        IRwaShareToken token;
        IERC20 paymentToken;
        address treasury; // funds batches, receives dust after CLOSED
        address feeRecipient;
        address admin;
        address operator;
        address reviewer;
        address pauser;
        uint32[] tierMinUnits;
        uint16[] tierBps;
    }

    bytes32 public immutable projectId;
    IAssetRegistry public immutable assetRegistry;
    IAuditRegistry public immutable auditRegistry;
    IIdentityRegistry public immutable identityRegistry;
    IRwaShareToken public immutable token;
    IERC20 public immutable paymentToken;
    address public immutable treasury;
    address public immutable feeRecipient;

    uint32[] private _tierMinUnits;
    uint16[] private _tierBps;

    uint256 public nextBatchId = 1;
    uint256 public pendingBatchId;
    uint256 public carriedDust;
    uint256 public totalUnclaimed;

    mapping(uint256 => Batch) private _batches;
    mapping(uint256 => mapping(address => Allocation)) private _allocations;
    /// @notice reportPeriodKey => amount already distributed against the active report for that period.
    mapping(bytes32 => uint256) public distributedForPeriod;

    event BatchProposed(
        uint256 indexed batchId,
        bytes32 indexed reportId,
        uint256 amount,
        uint64 snapshotBlock,
        uint256 pool,
        uint256 totalNet,
        uint256 totalFee,
        uint256 dustOut
    );
    event AllocationRecorded(
        uint256 indexed batchId, address indexed holder, uint256 units, uint256 gross, uint16 feeBps, uint256 net
    );
    event BatchApproved(uint256 indexed batchId, address indexed approver, address funder);
    event BatchRejected(uint256 indexed batchId, bytes32 reasonHash, address indexed reviewer);
    event Claimed(uint256 indexed batchId, address indexed holder, uint256 net, address caller);
    event DustCarried(uint256 indexed batchId, uint256 dust);
    event DustSwept(uint256 amount, address treasury);

    error ZeroValue();
    error BatchPending(uint256 batchId);
    error ProjectStateInvalid(ProjectState state);
    error ReportNotApproved(bytes32 reportId);
    error ReportMismatch(bytes32 reportId);
    error AmountExceedsReport(uint256 requested, uint256 remaining);
    error SnapshotOutOfRange(uint256 snapshotBlock);
    error TooManyHolders(uint256 count);
    error HoldersNotSorted(address holder);
    error HolderHasNoUnits(address holder);
    error HolderSetIncomplete(uint256 counted, uint256 supply);
    error NotProposed(uint256 batchId);
    error NotClaimable(uint256 batchId);
    error SelfApproval();
    error UnexpectedTransferAmount(uint256 expected, uint256 received);
    error AlreadyClaimed(uint256 batchId, address holder);
    error NothingToClaim(uint256 batchId, address holder);
    error HolderFrozen(address holder);
    error ProjectNotClosed();

    constructor(Params memory p) {
        if (
            p.projectId == 0 || address(p.assetRegistry) == address(0) || address(p.auditRegistry) == address(0)
                || address(p.identityRegistry) == address(0) || address(p.token) == address(0)
                || address(p.paymentToken) == address(0) || p.treasury == address(0) || p.feeRecipient == address(0)
                || p.admin == address(0)
        ) revert ZeroValue();
        FeeTiers.validate(p.tierMinUnits, p.tierBps);

        projectId = p.projectId;
        assetRegistry = p.assetRegistry;
        auditRegistry = p.auditRegistry;
        identityRegistry = p.identityRegistry;
        token = p.token;
        paymentToken = p.paymentToken;
        treasury = p.treasury;
        feeRecipient = p.feeRecipient;
        _tierMinUnits = p.tierMinUnits;
        _tierBps = p.tierBps;

        _grantRole(DEFAULT_ADMIN_ROLE, p.admin);
        if (p.operator != address(0)) _grantRole(OPERATOR_ROLE, p.operator);
        if (p.reviewer != address(0)) _grantRole(REVIEWER_ROLE, p.reviewer);
        if (p.pauser != address(0)) _grantRole(PAUSER_ROLE, p.pauser);
    }

    // ---------------------------------------------------------------------
    // Batch lifecycle
    // ---------------------------------------------------------------------

    /// @param holders Every holder at `snapshotBlock`, strictly ascending (proves uniqueness).
    function proposeBatch(bytes32 reportId, uint256 amount, uint64 snapshotBlock, address[] calldata holders)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        returns (uint256 batchId)
    {
        if (pendingBatchId != 0) revert BatchPending(pendingBatchId);
        ProjectState s = assetRegistry.stateOf(projectId);
        if (s != ProjectState.ACTIVE && s != ProjectState.EXIT_PENDING && s != ProjectState.TERMINATED) {
            revert ProjectStateInvalid(s);
        }
        if (amount == 0) revert ZeroValue();
        _checkReportCapacity(reportId, amount);

        if (snapshotBlock < assetRegistry.fundedAtBlock(projectId) || snapshotBlock >= block.number) {
            revert SnapshotOutOfRange(snapshotBlock);
        }
        uint256 n = holders.length;
        if (n == 0) revert ZeroValue();
        if (n > MAX_HOLDERS) revert TooManyHolders(n);

        uint256 supply = token.totalSupplyAt(snapshotBlock);
        if (supply == 0) revert HolderSetIncomplete(0, 0);

        batchId = nextBatchId++;
        Batch storage b = _batches[batchId];
        b.reportId = reportId;
        b.amount = amount;
        b.carriedDustIn = carriedDust;
        b.pool = amount + carriedDust;
        b.snapshotBlock = snapshotBlock;
        b.proposer = msg.sender;
        b.status = BatchStatus.PROPOSED;

        (uint256 counted, uint256 totalGross) = _allocate(batchId, b, holders, supply);
        if (counted != supply) revert HolderSetIncomplete(counted, supply);

        b.dustOut = b.pool - totalGross;
        pendingBatchId = batchId;
        emit BatchProposed(batchId, reportId, amount, snapshotBlock, b.pool, b.totalNet, b.totalFee, b.dustOut);
    }

    function approveBatch(uint256 batchId) external onlyRole(REVIEWER_ROLE) whenNotPaused nonReentrant {
        Batch storage b = _batches[batchId];
        if (b.status != BatchStatus.PROPOSED) revert NotProposed(batchId);
        if (msg.sender == b.proposer) revert SelfApproval();
        // The report may have been superseded or amended down since proposal.
        bytes32 key = _checkReportCapacity(b.reportId, b.amount);

        b.status = BatchStatus.CLAIMABLE;
        b.approver = msg.sender;
        pendingBatchId = 0;
        distributedForPeriod[key] += b.amount;
        carriedDust = b.dustOut;
        totalUnclaimed += b.totalNet;

        uint256 before = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(treasury, address(this), b.amount);
        uint256 received = paymentToken.balanceOf(address(this)) - before;
        if (received != b.amount) revert UnexpectedTransferAmount(b.amount, received);

        if (b.totalFee > 0) paymentToken.safeTransfer(feeRecipient, b.totalFee);
        emit BatchApproved(batchId, msg.sender, treasury);
        emit DustCarried(batchId, b.dustOut);
    }

    function rejectBatch(uint256 batchId, bytes32 reasonHash) external onlyRole(REVIEWER_ROLE) {
        if (reasonHash == 0) revert ZeroValue();
        Batch storage b = _batches[batchId];
        if (b.status != BatchStatus.PROPOSED) revert NotProposed(batchId);
        b.status = BatchStatus.REJECTED;
        pendingBatchId = 0;
        emit BatchRejected(batchId, reasonHash, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Claims
    // ---------------------------------------------------------------------

    function claim(uint256 batchId) external nonReentrant whenNotPaused {
        _claim(batchId, msg.sender);
    }

    function claimMany(uint256[] calldata batchIds) external nonReentrant whenNotPaused {
        for (uint256 i; i < batchIds.length; ++i) {
            _claim(batchIds[i], msg.sender);
        }
    }

    /// @notice Operator convenience; funds always go to `holder`.
    function claimFor(uint256 batchId, address holder) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        _claim(batchId, holder);
    }

    /// @notice After the project is CLOSED, residual dust goes to the issuer treasury.
    function sweepDust() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (assetRegistry.stateOf(projectId) != ProjectState.CLOSED) revert ProjectNotClosed();
        uint256 amount = carriedDust;
        if (amount == 0) revert ZeroValue();
        carriedDust = 0;
        paymentToken.safeTransfer(treasury, amount);
        emit DustSwept(amount, treasury);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function hasPendingBatch() external view returns (bool) {
        return pendingBatchId != 0;
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function allocationOf(uint256 batchId, address holder) external view returns (Allocation memory) {
        return _allocations[batchId][holder];
    }

    function tierBpsFor(uint256 units) external view returns (uint16) {
        return FeeTiers.bpsFor(_tierMinUnits, _tierBps, units);
    }

    function tiers() external view returns (uint32[] memory minUnits, uint16[] memory bps) {
        return (_tierMinUnits, _tierBps);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    struct AllocationContext {
        uint256 batchId;
        uint256 pool;
        uint256 supply;
        uint64 snapshotBlock;
        uint256 counted;
        uint256 totalGross;
        uint256 totalNet;
    }

    function _allocate(uint256 batchId, Batch storage b, address[] calldata holders, uint256 supply)
        private
        returns (uint256, uint256)
    {
        AllocationContext memory c = AllocationContext({
            batchId: batchId,
            pool: b.pool,
            supply: supply,
            snapshotBlock: b.snapshotBlock,
            counted: 0,
            totalGross: 0,
            totalNet: 0
        });
        address prev;
        for (uint256 i; i < holders.length; ++i) {
            address h = holders[i];
            if (h <= prev) revert HoldersNotSorted(h);
            prev = h;
            _allocateOne(c, h);
        }
        b.totalNet = c.totalNet;
        b.totalFee = c.totalGross - c.totalNet;
        return (c.counted, c.totalGross);
    }

    function _allocateOne(AllocationContext memory c, address holder) private {
        uint256 units = token.balanceOfAt(holder, c.snapshotBlock);
        if (units == 0) revert HolderHasNoUnits(holder);
        (uint256 gross, uint256 net) = _recordAllocation(c.batchId, holder, units, c.pool, c.supply);
        c.counted += units;
        c.totalGross += gross;
        c.totalNet += net;
    }

    function _recordAllocation(uint256 batchId, address holder, uint256 units, uint256 pool, uint256 supply)
        private
        returns (uint256 gross, uint256 net)
    {
        gross = Math.mulDiv(pool, units, supply);
        uint16 bps = FeeTiers.bpsFor(_tierMinUnits, _tierBps, units);
        net = gross - (gross * bps) / FeeTiers.BPS_DENOMINATOR;
        _allocations[batchId][holder] = Allocation({net: SafeCast.toUint128(net), feeBps: bps, claimed: false});
        emit AllocationRecorded(batchId, holder, units, gross, bps, net);
    }

    function _checkReportCapacity(bytes32 reportId, uint256 amount) private view returns (bytes32 key) {
        AuditRecord memory r = auditRegistry.getRecord(reportId);
        if (r.status != RecordStatus.APPROVED) revert ReportNotApproved(reportId);
        if (r.projectId != projectId || r.kind != RecordKind.FINANCIAL_REPORT || r.paymentToken != address(paymentToken))
        {
            revert ReportMismatch(reportId);
        }
        key = keccak256(abi.encode(r.periodStart, r.periodEnd));
        uint256 done = distributedForPeriod[key];
        uint256 remaining = r.distributableAmount > done ? r.distributableAmount - done : 0;
        if (amount > remaining) revert AmountExceedsReport(amount, remaining);
    }

    function _claim(uint256 batchId, address holder) private {
        if (_batches[batchId].status != BatchStatus.CLAIMABLE) revert NotClaimable(batchId);
        Allocation storage a = _allocations[batchId][holder];
        if (a.claimed) revert AlreadyClaimed(batchId, holder);
        if (a.net == 0) revert NothingToClaim(batchId, holder);
        if (identityRegistry.isFrozen(holder)) revert HolderFrozen(holder);
        uint256 net = a.net;
        a.claimed = true;
        totalUnclaimed -= net;
        paymentToken.safeTransfer(holder, net);
        emit Claimed(batchId, holder, net, msg.sender);
    }
}
