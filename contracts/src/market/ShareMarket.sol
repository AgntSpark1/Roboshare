// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AssetRegistry} from "../registry/AssetRegistry.sol";

/// @title ShareMarket
/// @notice Peer-to-peer resale of project units for USDT (EARLY_EXIT_DESIGN.md). A holder who wants
/// their money back early lists units at a price; any wallet that is not frozen buys them, and USDT and units
/// swap in one transaction. The platform may buy listings from its own wallet like any other
/// buyer; it has no special path and no obligation to buy.
/// @dev Non-custodial: units stay in the seller's wallet until sold (the seller approves this contract
/// on the share token) and USDT goes straight from buyer to seller. The contract never holds funds or
/// units and takes no fee. Every restriction of the share token (frozen sender or receiver,
/// project state FUNDED/ACTIVE, token pause) is enforced by the token itself during the
/// swap. Only tokens linked to a project in the AssetRegistry can be listed.
contract ShareMarket is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct Listing {
        address seller;
        bytes32 projectId;
        uint32 units; // still for sale; 0 once sold out or cancelled
        uint64 expiresAt;
        uint256 pricePerUnit; // USDT base units
    }

    IERC20 public immutable usdt;
    AssetRegistry public immutable assetRegistry;

    uint256 public nextListingId = 1;
    mapping(uint256 listingId => Listing) private _listings;

    event Listed(
        uint256 indexed listingId,
        bytes32 indexed projectId,
        address indexed seller,
        uint32 units,
        uint256 pricePerUnit,
        uint64 expiresAt
    );
    event ListingUpdated(uint256 indexed listingId, uint32 units, uint256 pricePerUnit, uint64 expiresAt);
    event ListingCancelled(uint256 indexed listingId);
    event Purchased(
        uint256 indexed listingId,
        bytes32 indexed projectId,
        address indexed buyer,
        address seller,
        uint32 units,
        uint256 pricePerUnit,
        uint256 cost
    );

    error ZeroValue();
    error TokenNotLinked(bytes32 projectId);
    error InvalidExpiry(uint64 expiresAt);
    error NotSeller();
    error ListingInactive(uint256 listingId);
    error ListingExpired(uint256 listingId);
    error InsufficientUnits(uint32 requested, uint32 available);
    error PriceAboveMax(uint256 pricePerUnit, uint256 maxPricePerUnit);
    error SelfPurchase();

    constructor(IERC20 usdt_, AssetRegistry assetRegistry_, address admin, address pauser) {
        if (address(usdt_) == address(0) || address(assetRegistry_) == address(0) || admin == address(0)) {
            revert ZeroValue();
        }
        usdt = usdt_;
        assetRegistry = assetRegistry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (pauser != address(0)) _grantRole(PAUSER_ROLE, pauser);
    }

    // ---------------------------------------------------------------------
    // Seller
    // ---------------------------------------------------------------------

    /// @notice Lists `units` of the caller's units in `projectId` at `pricePerUnit` USDT each.
    /// @dev Balance and allowance are not reserved; a buy fails if the seller no longer has them.
    function list(bytes32 projectId, uint32 units, uint256 pricePerUnit, uint64 expiresAt)
        external
        whenNotPaused
        returns (uint256 listingId)
    {
        tokenOf(projectId); // reverts if not linked
        _checkTerms(units, pricePerUnit, expiresAt);
        listingId = nextListingId++;
        _listings[listingId] = Listing({
            seller: msg.sender, projectId: projectId, units: units, expiresAt: expiresAt, pricePerUnit: pricePerUnit
        });
        emit Listed(listingId, projectId, msg.sender, units, pricePerUnit, expiresAt);
    }

    function updateListing(uint256 listingId, uint32 units, uint256 pricePerUnit, uint64 expiresAt)
        external
        whenNotPaused
    {
        Listing storage l = _ownActive(listingId);
        _checkTerms(units, pricePerUnit, expiresAt);
        l.units = units;
        l.pricePerUnit = pricePerUnit;
        l.expiresAt = expiresAt;
        emit ListingUpdated(listingId, units, pricePerUnit, expiresAt);
    }

    /// @notice Works while paused so sellers can always withdraw an offer.
    function cancel(uint256 listingId) external {
        Listing storage l = _ownActive(listingId);
        l.units = 0;
        emit ListingCancelled(listingId);
    }

    // ---------------------------------------------------------------------
    // Buyer
    // ---------------------------------------------------------------------

    /// @notice Buys `units` from a listing. The caller must have approved this contract for USDT.
    /// @param maxPricePerUnit Highest unit price the buyer accepts; protects against a price change
    /// landing just before the purchase.
    function buy(uint256 listingId, uint32 units, uint256 maxPricePerUnit) external nonReentrant whenNotPaused {
        if (units == 0) revert ZeroValue();
        Listing storage l = _listings[listingId];
        if (l.units == 0) revert ListingInactive(listingId);
        if (block.timestamp >= l.expiresAt) revert ListingExpired(listingId);
        if (units > l.units) revert InsufficientUnits(units, l.units);
        if (l.pricePerUnit > maxPricePerUnit) revert PriceAboveMax(l.pricePerUnit, maxPricePerUnit);
        address seller = l.seller;
        if (msg.sender == seller) revert SelfPurchase();

        uint256 price = l.pricePerUnit;
        uint256 cost = uint256(units) * price;
        l.units -= units;

        usdt.safeTransferFrom(msg.sender, seller, cost);
        // The share token enforces the freeze list, project state and pause.
        IERC20(tokenOf(l.projectId)).safeTransferFrom(seller, msg.sender, units);
        emit Purchased(listingId, l.projectId, msg.sender, seller, units, price, cost);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return _listings[listingId];
    }

    /// @notice Units a buyer could take right now, given expiry and the seller's balance and allowance.
    /// Does not check the freeze list or the project state; use the token's `canTransfer`.
    function fillable(uint256 listingId) external view returns (uint32) {
        Listing storage l = _listings[listingId];
        if (l.units == 0 || block.timestamp >= l.expiresAt) return 0;
        IERC20 token = IERC20(tokenOf(l.projectId));
        uint256 n = l.units;
        uint256 bal = token.balanceOf(l.seller);
        uint256 allowed = token.allowance(l.seller, address(this));
        if (bal < n) n = bal;
        if (allowed < n) n = allowed;
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(n); // n <= l.units
    }

    function tokenOf(bytes32 projectId) public view returns (address token) {
        token = assetRegistry.getProject(projectId).token;
        if (token == address(0)) revert TokenNotLinked(projectId);
    }

    // ---------------------------------------------------------------------
    // Governance
    // ---------------------------------------------------------------------

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _checkTerms(uint32 units, uint256 pricePerUnit, uint64 expiresAt) private view {
        if (units == 0 || pricePerUnit == 0) revert ZeroValue();
        if (expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);
    }

    function _ownActive(uint256 listingId) private view returns (Listing storage l) {
        l = _listings[listingId];
        if (l.seller != msg.sender) revert NotSeller();
        if (l.units == 0) revert ListingInactive(listingId);
    }
}
