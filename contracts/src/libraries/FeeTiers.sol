// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title FeeTiers
/// @notice Operator-fee tier lookup. Tier `i` applies to holdings of at least `minUnits[i]` units.
/// Default business rule (proposed, not a market standard):
///   1-4 units 20%, 5-9 17.5%, 10-19 15%, 20-49 12.5%, 50-100 10%.
library FeeTiers {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Projects with an operating term of at least LONG_TERM_DAYS pay LONG_TERM_DISCOUNT_BPS less
    /// on every tier (OPERATING_TERM_PROPOSAL.md §4.4): 720 days -> 17.5%, 15%, 12.5%, 10%, 7.5%.
    uint32 internal constant LONG_TERM_DAYS = 720;
    uint16 internal constant LONG_TERM_DISCOUNT_BPS = 250;

    error InvalidTiers();

    function defaultTiers() internal pure returns (uint32[] memory minUnits, uint16[] memory bps) {
        minUnits = new uint32[](5);
        bps = new uint16[](5);
        (minUnits[0], minUnits[1], minUnits[2], minUnits[3], minUnits[4]) = (1, 5, 10, 20, 50);
        (bps[0], bps[1], bps[2], bps[3], bps[4]) = (2000, 1750, 1500, 1250, 1000);
    }

    /// @notice Default tiers for a project with the given operating term.
    function tiersForTerm(uint32 termDays) internal pure returns (uint32[] memory minUnits, uint16[] memory bps) {
        (minUnits, bps) = defaultTiers();
        if (termDays >= LONG_TERM_DAYS) {
            for (uint256 i; i < bps.length; ++i) {
                bps[i] -= LONG_TERM_DISCOUNT_BPS;
            }
        }
    }

    /// @dev Thresholds strictly ascending and starting at 1; bps non-increasing and <= 10_000.
    function validate(uint32[] memory minUnits, uint16[] memory bps) internal pure {
        uint256 n = minUnits.length;
        if (n == 0 || n != bps.length || minUnits[0] != 1) revert InvalidTiers();
        for (uint256 i; i < n; ++i) {
            if (bps[i] > BPS_DENOMINATOR) revert InvalidTiers();
            if (i > 0 && (minUnits[i] <= minUnits[i - 1] || bps[i] > bps[i - 1])) revert InvalidTiers();
        }
    }

    function bpsFor(uint32[] storage minUnits, uint16[] storage bps, uint256 units) internal view returns (uint16) {
        uint256 i = minUnits.length;
        while (i > 0) {
            --i;
            if (units >= minUnits[i]) return bps[i];
        }
        return bps[0];
    }
}
