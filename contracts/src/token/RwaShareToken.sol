// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAssetRegistry, IIdentityRegistry, IRwaShareToken, ProjectState} from "../interfaces/IRoboShare.sol";

/// @title RwaShareToken
/// @notice One restricted-transfer token per vehicle project. ERC-20 interface and events with
/// 0 decimals and a hard cap of 100 units. Transfers revert unless the receiver is eligible, neither
/// side is frozen, and the project is FUNDED or ACTIVE. There is no forced transfer and no burn.
/// A unit is a contractual economic right defined by the project's Rights Document; it is not
/// ownership of the vehicle.
contract RwaShareToken is IRwaShareToken, ERC20, AccessControl, Pausable {
    using Checkpoints for Checkpoints.Trace208;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant CAP = 100;

    bytes32 public immutable projectId;
    IAssetRegistry public immutable assetRegistry;
    IIdentityRegistry public immutable identityRegistry;
    /// @notice Bit `c` set means investor class `c` may hold this token.
    uint256 public immutable allowedClassesMask;
    address public immutable minterBinder;

    address public minter;

    mapping(address => Checkpoints.Trace208) private _balanceCheckpoints;
    Checkpoints.Trace208 private _supplyCheckpoints;

    bytes32 public constant REASON_OK = "OK";
    bytes32 public constant REASON_PAUSED = "PAUSED";
    bytes32 public constant REASON_ZERO_AMOUNT = "ZERO_AMOUNT";
    bytes32 public constant REASON_STATE = "TRANSFERS_DISABLED_IN_STATE";
    bytes32 public constant REASON_SENDER_FROZEN = "SENDER_FROZEN";
    bytes32 public constant REASON_RECEIVER_NOT_ELIGIBLE = "RECEIVER_NOT_ELIGIBLE";
    bytes32 public constant REASON_CLASS = "CLASS_NOT_ALLOWED";
    bytes32 public constant REASON_BALANCE = "INSUFFICIENT_BALANCE";

    event MinterBound(address indexed minter);

    error ZeroValue();
    error OnlyMinter();
    error OnlyMinterBinder();
    error MinterAlreadyBound();
    error CapExceeded(uint256 requested, uint256 remaining);
    error ZeroAmount();
    error BurnDisabled();
    error TransfersDisabledInState(ProjectState state);
    error SenderFrozen(address wallet);
    error NotEligible(address wallet);
    error ClassNotAllowed(address wallet, uint16 investorClass);
    error FutureLookup(uint256 blockNumber);

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 projectId_,
        IAssetRegistry assetRegistry_,
        IIdentityRegistry identityRegistry_,
        uint256 allowedClassesMask_,
        address admin,
        address pauser,
        address minterBinder_
    ) ERC20(name_, symbol_) {
        if (
            projectId_ == 0 || address(assetRegistry_) == address(0) || address(identityRegistry_) == address(0)
                || allowedClassesMask_ == 0 || admin == address(0) || minterBinder_ == address(0)
        ) revert ZeroValue();
        projectId = projectId_;
        assetRegistry = assetRegistry_;
        identityRegistry = identityRegistry_;
        allowedClassesMask = allowedClassesMask_;
        minterBinder = minterBinder_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Binds the project's OfferingManager as the only minter. Callable once.
    function bindMinter(address minter_) external {
        if (msg.sender != minterBinder) revert OnlyMinterBinder();
        if (minter != address(0)) revert MinterAlreadyBound();
        if (minter_ == address(0)) revert ZeroValue();
        minter = minter_;
        emit MinterBound(minter_);
    }

    function mint(address to, uint256 units) external {
        if (msg.sender != minter) revert OnlyMinter();
        _mint(to, units);
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

    function isClassAllowed(uint16 investorClass) public view returns (bool) {
        return investorClass != 0 && investorClass < 256 && (allowedClassesMask >> investorClass) & 1 == 1;
    }

    /// @notice Balance of `account` at the end of block `blockNumber`. Only past blocks.
    function balanceOfAt(address account, uint256 blockNumber) external view returns (uint256) {
        if (blockNumber >= block.number) revert FutureLookup(blockNumber);
        return _balanceCheckpoints[account].upperLookupRecent(SafeCast.toUint48(blockNumber));
    }

    /// @notice Total supply at the end of block `blockNumber`. Only past blocks.
    function totalSupplyAt(uint256 blockNumber) external view returns (uint256) {
        if (blockNumber >= block.number) revert FutureLookup(blockNumber);
        return _supplyCheckpoints.upperLookupRecent(SafeCast.toUint48(blockNumber));
    }

    /// @notice Explains whether a transfer would succeed, so wallets and the UI can show the reason.
    function canTransfer(address from, address to, uint256 value) external view returns (bool, bytes32) {
        if (paused()) return (false, REASON_PAUSED);
        if (value == 0) return (false, REASON_ZERO_AMOUNT);
        if (!_transfersOpen()) return (false, REASON_STATE);
        if (identityRegistry.isFrozen(from)) return (false, REASON_SENDER_FROZEN);
        if (identityRegistry.checksRequired()) {
            if (!identityRegistry.isEligible(to)) return (false, REASON_RECEIVER_NOT_ELIGIBLE);
            if (!isClassAllowed(identityRegistry.classOf(to))) return (false, REASON_CLASS);
        } else if (identityRegistry.isFrozen(to)) {
            return (false, REASON_RECEIVER_NOT_ELIGIBLE);
        }
        if (balanceOf(from) < value) return (false, REASON_BALANCE);
        return (true, REASON_OK);
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _update(address from, address to, uint256 value) internal override {
        _requireNotPaused();
        if (value == 0) revert ZeroAmount();
        if (to == address(0)) revert BurnDisabled();

        if (from == address(0)) {
            uint256 supply = totalSupply();
            if (supply + value > CAP) revert CapExceeded(value, CAP - supply);
        } else {
            if (!_transfersOpen()) revert TransfersDisabledInState(assetRegistry.stateOf(projectId));
            if (identityRegistry.isFrozen(from)) revert SenderFrozen(from);
        }
        _checkReceiver(to);

        super._update(from, to, value);

        uint48 key = SafeCast.toUint48(block.number);
        if (from != address(0)) _balanceCheckpoints[from].push(key, SafeCast.toUint208(balanceOf(from)));
        _balanceCheckpoints[to].push(key, SafeCast.toUint208(balanceOf(to)));
        if (from == address(0)) _supplyCheckpoints.push(key, SafeCast.toUint208(totalSupply()));
    }

    function _checkReceiver(address to) private view {
        if (!identityRegistry.checksRequired()) {
            if (identityRegistry.isFrozen(to)) revert NotEligible(to);
            return;
        }
        if (!identityRegistry.isEligible(to)) revert NotEligible(to);
        uint16 cls = identityRegistry.classOf(to);
        if (!isClassAllowed(cls)) revert ClassNotAllowed(to, cls);
    }

    function _transfersOpen() private view returns (bool) {
        ProjectState s = assetRegistry.stateOf(projectId);
        return s == ProjectState.FUNDED || s == ProjectState.ACTIVE;
    }
}
