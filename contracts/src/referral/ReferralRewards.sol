// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title ReferralRewards
/// @notice Pays referral rewards (REFERRAL_DESIGN.md) in USDT by Merkle proof. The platform tops the
/// contract up from its own fee income; it never touches investor principal, escrow or distribution
/// pools. Each published root commits to every referrer's CUMULATIVE reward; a claim pays the
/// difference to what that account already received, so a newer root supersedes older ones.
/// @dev Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount)))), the
/// OpenZeppelin StandardMerkleTree layout. Claims are off until governance enables them.
contract ReferralRewards is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ROOT_SETTER_ROLE = keccak256("ROOT_SETTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    IERC20 public immutable paymentToken;

    bool public claimsEnabled;
    bytes32 public merkleRoot;
    uint64 public epoch;
    mapping(address account => uint256) public claimed;
    uint256 public totalClaimed;

    event ReferralRootSet(uint64 indexed epoch, bytes32 root, bytes32 dataHash, uint256 totalCumulative);
    event ReferralRewardClaimed(address indexed account, uint256 amount, uint256 cumulative);
    event ClaimsEnabledSet(bool enabled);
    event SurplusWithdrawn(address indexed to, uint256 amount);

    error ZeroValue();
    error ClaimsDisabled();
    error InvalidProof();
    error NothingToClaim();

    constructor(IERC20 paymentToken_, address admin, address rootSetter, address pauser) {
        if (address(paymentToken_) == address(0) || admin == address(0) || rootSetter == address(0)) {
            revert ZeroValue();
        }
        paymentToken = paymentToken_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ROOT_SETTER_ROLE, rootSetter);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
    }

    /// @param dataHash Hash of the published reward file the root was built from, for audit.
    /// @param totalCumulative Sum of every leaf's cumulative amount, so funding can be checked on chain.
    function setRoot(bytes32 root, bytes32 dataHash, uint256 totalCumulative) external onlyRole(ROOT_SETTER_ROLE) {
        if (root == bytes32(0)) revert ZeroValue();
        merkleRoot = root;
        emit ReferralRootSet(++epoch, root, dataHash, totalCumulative);
    }

    /// @notice Anyone may submit the claim; the reward always goes to `account`.
    function claim(address account, uint256 cumulativeAmount, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
    {
        if (!claimsEnabled) revert ClaimsDisabled();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))));
        if (!MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();
        uint256 already = claimed[account];
        if (cumulativeAmount <= already) revert NothingToClaim();
        uint256 amount = cumulativeAmount - already;
        claimed[account] = cumulativeAmount;
        totalClaimed += amount;
        paymentToken.safeTransfer(account, amount);
        emit ReferralRewardClaimed(account, amount, cumulativeAmount);
    }

    /// @notice Governance (Safe) master switch. Off by default; mainnet needs legal sign-off first.
    function setClaimsEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimsEnabled = enabled;
        emit ClaimsEnabledSet(enabled);
    }

    /// @notice Governance (Safe) can take back platform funds, e.g. when the programme ends.
    function withdraw(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0) || amount == 0) revert ZeroValue();
        paymentToken.safeTransfer(to, amount);
        emit SurplusWithdrawn(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
