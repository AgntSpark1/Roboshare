// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IAssetRegistry,
    IIdentityRegistry,
    IOfferingManager,
    IRwaShareToken,
    ISubscriptionRouter,
    ProjectState
} from "../interfaces/IRoboShare.sol";

/// @title OfferingManager
/// @notice Escrows USDT subscriptions for one project, then either settles (mints units and sends
/// proceeds to the issuer treasury) or makes every subscription refundable. Subscriptions arrive
/// only through the SubscriptionRouter. Partial offerings are allowed down to `minUnits`.
contract OfferingManager is IOfferingManager, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum SubStatus {
        NONE,
        ESCROWED,
        SETTLED,
        REFUNDABLE,
        REFUNDED
    }

    enum Outcome {
        NONE,
        SETTLED,
        FAILED,
        CANCELLED
    }

    struct OfferingConfig {
        uint256 unitPrice; // USDT base units per unit
        uint32 minUnits; // 1..maxUnits; partial fill allowed (D-4)
        uint32 maxUnits; // must equal token CAP
        uint32 perWalletMax; // 1..maxUnits
        uint64 startTime;
        uint64 endTime;
        address treasury;
        bytes32 termsHash; // AuditRegistry recordId of the offering terms
    }

    bytes32 public immutable projectId;
    IAssetRegistry public immutable assetRegistry;
    IIdentityRegistry public immutable identityRegistry;
    IRwaShareToken public immutable token;
    address public immutable router;
    IERC20 public immutable paymentToken;

    OfferingConfig public config;
    bool public configured;
    bool public opened;
    Outcome public outcome;

    uint32 public unitsSold;
    /// @notice USDT held for subscriptions that are ESCROWED or REFUNDABLE.
    uint256 public escrowed;

    address[] private _subscribers;
    mapping(address => uint32) public unitsOf;
    mapping(address => uint256) public paidOf;
    mapping(address => SubStatus) public statusOf;

    event OfferingConfigured(OfferingConfig config);
    event OfferingOpened(bytes32 termsHash);
    event Subscribed(address indexed investor, uint32 units, uint256 amount);
    event SubscriberExcluded(address indexed investor, bytes32 reasonHash);
    event OfferingSettled(uint32 unitsSold, uint256 proceeds, address treasury);
    event OfferingFailed(uint32 unitsSold, uint32 minUnits);
    event OfferingCancelled(bytes32 reasonHash);
    event RefundClaimed(address indexed investor, uint256 amount);

    error ZeroValue();
    error InvalidConfig();
    error AlreadyConfigured();
    error NotConfigured();
    error AlreadyOpened();
    error NotOpen();
    error ProjectNotVerified(ProjectState state);
    error OnlyRouter();
    error OfferingWindowClosed();
    error OfferingFinalized();
    error CostMismatch(uint256 expected, uint256 provided);
    error UnitsExceedAvailable(uint32 requested, uint32 available);
    error PerWalletLimit(uint32 requested, uint32 allowed);
    error NotEligible(address wallet);
    error ClassNotAllowed(address wallet);
    error SubscriptionClosedForWallet(address wallet);
    error UnexpectedTransferAmount(uint256 expected, uint256 received);
    error SettlementConditionsNotMet();
    error SubscriberIneligible(address wallet);
    error FailureConditionsNotMet();
    error NotRefundable(address wallet);

    constructor(
        bytes32 projectId_,
        IAssetRegistry assetRegistry_,
        IIdentityRegistry identityRegistry_,
        IRwaShareToken token_,
        address router_,
        address admin,
        address operator,
        address pauser
    ) {
        if (
            projectId_ == 0 || address(assetRegistry_) == address(0) || address(identityRegistry_) == address(0)
                || address(token_) == address(0) || router_ == address(0) || admin == address(0)
        ) revert ZeroValue();
        projectId = projectId_;
        assetRegistry = assetRegistry_;
        identityRegistry = identityRegistry_;
        token = token_;
        router = router_;
        paymentToken = IERC20(ISubscriptionRouter(router_).USDT());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (operator != address(0)) _grantRole(OPERATOR_ROLE, operator);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
    }

    // ---------------------------------------------------------------------
    // Governance: configure and open
    // ---------------------------------------------------------------------

    function configure(OfferingConfig calldata cfg) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (opened) revert AlreadyOpened();
        if (configured) revert AlreadyConfigured();
        ProjectState s = assetRegistry.stateOf(projectId);
        if (s != ProjectState.VERIFIED) revert ProjectNotVerified(s);
        if (
            cfg.unitPrice == 0 || cfg.maxUnits != token.CAP() || cfg.minUnits == 0 || cfg.minUnits > cfg.maxUnits
                || cfg.perWalletMax == 0 || cfg.perWalletMax > cfg.maxUnits || cfg.startTime >= cfg.endTime
                || cfg.endTime <= block.timestamp || cfg.treasury == address(0) || cfg.termsHash == 0
        ) revert InvalidConfig();
        config = cfg;
        configured = true;
        emit OfferingConfigured(cfg);
    }

    function open() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!configured) revert NotConfigured();
        if (opened) revert AlreadyOpened();
        opened = true;
        assetRegistry.markOffering(projectId, config.termsHash);
        emit OfferingOpened(config.termsHash);
    }

    // ---------------------------------------------------------------------
    // Subscription (router only)
    // ---------------------------------------------------------------------

    function quote(uint32 units) public view returns (uint256) {
        return uint256(units) * config.unitPrice;
    }

    /// @notice Records a subscription whose USDT the router has already moved into this contract.
    /// Reverts (undoing the router's transfer) if any check fails or the received amount is wrong.
    function subscribeFor(address investor, uint32 units, uint256 cost) external nonReentrant whenNotPaused {
        if (msg.sender != router) revert OnlyRouter();
        if (!opened) revert NotOpen();
        if (outcome != Outcome.NONE) revert OfferingFinalized();
        if (block.timestamp < config.startTime || block.timestamp >= config.endTime) revert OfferingWindowClosed();
        if (units == 0) revert ZeroValue();

        uint256 expected = quote(units);
        if (cost != expected) revert CostMismatch(expected, cost);

        uint32 available = config.maxUnits - unitsSold;
        if (units > available) revert UnitsExceedAvailable(units, available);
        uint32 walletUnits = unitsOf[investor] + units;
        if (walletUnits > config.perWalletMax) revert PerWalletLimit(units, config.perWalletMax - unitsOf[investor]);

        SubStatus status = statusOf[investor];
        if (status != SubStatus.NONE && status != SubStatus.ESCROWED) revert SubscriptionClosedForWallet(investor);
        if (identityRegistry.checksRequired()) {
            if (!identityRegistry.isEligible(investor)) revert NotEligible(investor);
            if (!token.isClassAllowed(identityRegistry.classOf(investor))) revert ClassNotAllowed(investor);
        } else if (identityRegistry.isFrozen(investor)) {
            revert NotEligible(investor);
        }

        // `>=` rather than `==`: a direct USDT donation to this contract must not block subscriptions.
        // Any surplus stays outside `escrowed` and is never paid to anyone.
        uint256 received = paymentToken.balanceOf(address(this)) - escrowed;
        if (received < cost) revert UnexpectedTransferAmount(cost, received);

        if (status == SubStatus.NONE) {
            _subscribers.push(investor);
            statusOf[investor] = SubStatus.ESCROWED;
        }
        unitsOf[investor] = walletUnits;
        paidOf[investor] += cost;
        unitsSold += units;
        escrowed += cost;
        emit Subscribed(investor, units, cost);
    }

    // ---------------------------------------------------------------------
    // Outcomes
    // ---------------------------------------------------------------------

    /// @notice Governance removes a subscriber (e.g. eligibility lapsed) before settlement.
    function excludeSubscriber(address investor, bytes32 reasonHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (outcome != Outcome.NONE) revert OfferingFinalized();
        if (statusOf[investor] != SubStatus.ESCROWED) revert NotRefundable(investor);
        statusOf[investor] = SubStatus.REFUNDABLE;
        unitsSold -= unitsOf[investor];
        emit SubscriberExcluded(investor, reasonHash);
    }

    function settle() external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        if (!opened) revert NotOpen();
        if (outcome != Outcome.NONE) revert OfferingFinalized();
        bool ended = block.timestamp >= config.endTime;
        if (unitsSold < config.minUnits || !(ended || unitsSold == config.maxUnits)) {
            revert SettlementConditionsNotMet();
        }

        outcome = Outcome.SETTLED;
        uint256 proceeds;
        uint256 n = _subscribers.length;
        bool checks = identityRegistry.checksRequired();
        for (uint256 i; i < n; ++i) {
            address s = _subscribers[i];
            if (statusOf[s] != SubStatus.ESCROWED) continue;
            if (
                checks
                    ? !identityRegistry.isEligible(s) || !token.isClassAllowed(identityRegistry.classOf(s))
                    : identityRegistry.isFrozen(s)
            ) revert SubscriberIneligible(s);
            statusOf[s] = SubStatus.SETTLED;
            proceeds += paidOf[s];
            token.mint(s, unitsOf[s]);
        }
        escrowed -= proceeds;
        assetRegistry.markFunded(projectId, config.termsHash);
        paymentToken.safeTransfer(config.treasury, proceeds);
        emit OfferingSettled(unitsSold, proceeds, config.treasury);
    }

    /// @notice Anyone may finalize a failed offering after the deadline so refunds open.
    function finalizeFailed() external nonReentrant whenNotPaused {
        if (!opened) revert NotOpen();
        if (outcome != Outcome.NONE) revert OfferingFinalized();
        if (block.timestamp < config.endTime || unitsSold >= config.minUnits) revert FailureConditionsNotMet();
        outcome = Outcome.FAILED;
        _makeAllRefundable();
        assetRegistry.markCancelled(projectId, config.termsHash);
        emit OfferingFailed(unitsSold, config.minUnits);
    }

    function cancel(bytes32 reasonHash) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (!opened) revert NotOpen();
        if (outcome != Outcome.NONE) revert OfferingFinalized();
        if (reasonHash == 0) revert ZeroValue();
        outcome = Outcome.CANCELLED;
        _makeAllRefundable();
        assetRegistry.markCancelled(projectId, reasonHash);
        emit OfferingCancelled(reasonHash);
    }

    function claimRefund() external nonReentrant whenNotPaused {
        if (statusOf[msg.sender] != SubStatus.REFUNDABLE) revert NotRefundable(msg.sender);
        uint256 amount = paidOf[msg.sender];
        statusOf[msg.sender] = SubStatus.REFUNDED;
        escrowed -= amount;
        paymentToken.safeTransfer(msg.sender, amount);
        emit RefundClaimed(msg.sender, amount);
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

    function subscribers() external view returns (address[] memory) {
        return _subscribers;
    }

    function subscriberCount() external view returns (uint256) {
        return _subscribers.length;
    }

    function _makeAllRefundable() private {
        uint256 n = _subscribers.length;
        for (uint256 i; i < n; ++i) {
            address s = _subscribers[i];
            if (statusOf[s] == SubStatus.ESCROWED) statusOf[s] = SubStatus.REFUNDABLE;
        }
    }
}
