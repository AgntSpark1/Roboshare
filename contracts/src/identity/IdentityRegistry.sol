// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IIdentityRegistry} from "../interfaces/IRoboShare.sol";

/// @title IdentityRegistry
/// @notice Records whether a wallet may hold or receive restricted RoboShare tokens.
/// Stores only codes, an expiry and a hash reference to an off-chain attestation. No personal data.
/// Eligibility and class checks apply only while `checksRequired` is on. It is off by default (Charlene,
/// 2026-10-11: no KYC for now), so any wallet that is not frozen may subscribe, hold and receive units.
/// Governance can switch checks back on, e.g. if counsel requires KYC before a public offering.
contract IdentityRegistry is IIdentityRegistry, AccessControl, Pausable {
    bytes32 public constant COMPLIANCE_AGENT_ROLE = keccak256("COMPLIANCE_AGENT_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant MAX_BATCH = 50;

    enum EligibilityStatus {
        NONE,
        ELIGIBLE,
        FROZEN
    }

    struct Eligibility {
        EligibilityStatus status;
        uint16 investorClass; // 1..255, codebook kept off-chain
        uint16 jurisdiction; // ISO-3166 numeric
        uint64 expiresAt;
        bytes32 attestationRef; // hash of the provider attestation id
    }

    mapping(address => Eligibility) private _eligibility;
    /// @notice When false, consumers skip eligibility and class checks; frozen wallets stay blocked.
    bool public checksRequired;

    event EligibilitySet(
        address indexed wallet,
        uint16 investorClass,
        uint16 jurisdiction,
        uint64 expiresAt,
        bytes32 attestationRef,
        address indexed agent
    );
    event EligibilityRevoked(address indexed wallet, bytes32 reasonCode, address indexed agent);
    event WalletFrozen(address indexed wallet, bytes32 reasonCode, address indexed agent);
    event WalletUnfrozen(address indexed wallet, address indexed admin);
    event ChecksRequiredSet(bool required, address indexed admin);

    error ZeroAddress();
    error InvalidClass(uint16 investorClass);
    error ExpiryInPast(uint64 expiresAt);
    error WalletIsFrozen(address wallet);
    error WalletNotFrozen(address wallet);
    error BatchTooLarge(uint256 length);
    error LengthMismatch();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Compliance agent
    // ---------------------------------------------------------------------

    function setEligibility(
        address wallet,
        uint16 investorClass,
        uint16 jurisdiction,
        uint64 expiresAt,
        bytes32 attestationRef
    ) external onlyRole(COMPLIANCE_AGENT_ROLE) whenNotPaused {
        _setEligibility(wallet, investorClass, jurisdiction, expiresAt, attestationRef);
    }

    function batchSetEligibility(
        address[] calldata wallets,
        uint16[] calldata classes,
        uint16[] calldata jurisdictions,
        uint64[] calldata expiries,
        bytes32[] calldata attestationRefs
    ) external onlyRole(COMPLIANCE_AGENT_ROLE) whenNotPaused {
        uint256 n = wallets.length;
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        if (
            classes.length != n || jurisdictions.length != n || expiries.length != n
                || attestationRefs.length != n
        ) revert LengthMismatch();
        for (uint256 i; i < n; ++i) {
            _setEligibility(wallets[i], classes[i], jurisdictions[i], expiries[i], attestationRefs[i]);
        }
    }

    function revoke(address wallet, bytes32 reasonCode) external onlyRole(COMPLIANCE_AGENT_ROLE) whenNotPaused {
        if (_eligibility[wallet].status == EligibilityStatus.FROZEN) revert WalletIsFrozen(wallet);
        delete _eligibility[wallet];
        emit EligibilityRevoked(wallet, reasonCode, msg.sender);
    }

    /// @notice Freezing keeps the stored class and expiry for the record. Only governance can unfreeze.
    function freeze(address wallet, bytes32 reasonCode) external onlyRole(COMPLIANCE_AGENT_ROLE) whenNotPaused {
        if (wallet == address(0)) revert ZeroAddress();
        _eligibility[wallet].status = EligibilityStatus.FROZEN;
        emit WalletFrozen(wallet, reasonCode, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Governance
    // ---------------------------------------------------------------------

    /// @notice Unfreezing returns the wallet to NONE; the compliance agent must re-establish eligibility.
    function unfreeze(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_eligibility[wallet].status != EligibilityStatus.FROZEN) revert WalletNotFrozen(wallet);
        _eligibility[wallet].status = EligibilityStatus.NONE;
        emit WalletUnfrozen(wallet, msg.sender);
    }

    /// @notice Governance turns eligibility and class checks on or off for every project at once.
    function setChecksRequired(bool required) external onlyRole(DEFAULT_ADMIN_ROLE) {
        checksRequired = required;
        emit ChecksRequiredSet(required, msg.sender);
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

    function isEligible(address wallet) public view returns (bool) {
        Eligibility storage e = _eligibility[wallet];
        return e.status == EligibilityStatus.ELIGIBLE && block.timestamp < e.expiresAt;
    }

    function isFrozen(address wallet) public view returns (bool) {
        return _eligibility[wallet].status == EligibilityStatus.FROZEN;
    }

    function classOf(address wallet) external view returns (uint16) {
        return _eligibility[wallet].investorClass;
    }

    function jurisdictionOf(address wallet) external view returns (uint16) {
        return _eligibility[wallet].jurisdiction;
    }

    function eligibilityOf(address wallet) external view returns (Eligibility memory) {
        return _eligibility[wallet];
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _setEligibility(
        address wallet,
        uint16 investorClass,
        uint16 jurisdiction,
        uint64 expiresAt,
        bytes32 attestationRef
    ) private {
        if (wallet == address(0)) revert ZeroAddress();
        if (investorClass == 0 || investorClass > 255) revert InvalidClass(investorClass);
        if (expiresAt <= block.timestamp) revert ExpiryInPast(expiresAt);
        if (_eligibility[wallet].status == EligibilityStatus.FROZEN) revert WalletIsFrozen(wallet);
        _eligibility[wallet] = Eligibility({
            status: EligibilityStatus.ELIGIBLE,
            investorClass: investorClass,
            jurisdiction: jurisdiction,
            expiresAt: expiresAt,
            attestationRef: attestationRef
        });
        emit EligibilitySet(wallet, investorClass, jurisdiction, expiresAt, attestationRef, msg.sender);
    }
}
