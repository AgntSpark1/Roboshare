// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title FeeTiers
/// @notice Operator-fee tier lookup. Tier `i` applies to holdings of at least `minUnits[i]` units.
/// Default for new projects (REFERRAL_DESIGN.md §10, 2026-10-27): one flat 30% platform share, so holders
/// keep 70%; promotion rewards are paid out of that 30%. Projects deployed earlier keep the tiers they
/// were deployed with (1-4 units 20% ... 50+ 10%, 2.5% less for terms of 720 days or more).
library FeeTiers {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    uint16 internal constant PLATFORM_SHARE_BPS = 3000;

    error InvalidTiers();

    function defaultTiers() internal pure returns (uint32[] memory minUnits, uint16[] memory bps) {
        minUnits = new uint32[](1);
        bps = new uint16[](1);
        (minUnits[0], bps[0]) = (1, PLATFORM_SHARE_BPS);
    }

    /// @notice Default tiers for a project with the given operating term: the same flat share for every term.
    function tiersForTerm(uint32) internal pure returns (uint32[] memory minUnits, uint16[] memory bps) {
        return defaultTiers();
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
