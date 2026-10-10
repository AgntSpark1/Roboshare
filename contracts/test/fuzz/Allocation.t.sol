// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RevenueDistributor} from "../../src/distribution/RevenueDistributor.sol";

/// Required test 7/8 (fuzzed): every base unit of the pool is accounted for, and dust stays below
/// the holder count.
contract AllocationFuzzTest is BaseTest {
    function testFuzz_AllocationConservesPool(uint256 seed, uint8 holderCount, uint256 amount) public {
        uint256 n = bound(holderCount, 1, 12);
        amount = bound(amount, 1, 1e33);

        address[] memory hs = new address[](n);
        uint32[] memory us = new uint32[](n);
        uint32 left = 100;
        for (uint256 i; i < n; ++i) {
            hs[i] = makeAddr(string(abi.encodePacked("fuzzHolder", vm.toString(i))));
            uint32 maxHere = left - uint32(n - 1 - i); // leave at least 1 unit for each later holder
            us[i] = i == n - 1 ? left : uint32(bound(uint256(keccak256(abi.encode(seed, i))), 1, maxHere));
            left -= us[i];
        }
        _fundAndActivate(hs, us);

        bytes32 reportId = _approvedReport(amount, 1, 2);
        _fundTreasury(amount);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(reportId, amount, uint64(block.number - 1), _sorted(_copy(hs)));
        RevenueDistributor.Batch memory b = distributor.getBatch(id);

        uint256 sumNet;
        uint256 sumFee;
        for (uint256 i; i < n; ++i) {
            uint256 gross = Math.mulDiv(amount, us[i], 100);
            uint256 net = distributor.allocationOf(id, hs[i]).net;
            assertEq(net, gross - gross * distributor.tierBpsFor(us[i]) / 10_000, "net formula");
            sumNet += net;
            sumFee += gross - net;
        }
        assertEq(b.totalNet, sumNet);
        assertEq(b.totalFee, sumFee);
        assertEq(sumNet + sumFee + b.dustOut, b.pool, "pool conserved");
        assertLt(b.dustOut, n, "dust < holders");

        vm.prank(reviewer);
        distributor.approveBatch(id);
        assertEq(usdt.balanceOf(address(distributor)), distributor.totalUnclaimed() + distributor.carriedDust());
    }

    function _copy(address[] memory a) private pure returns (address[] memory c) {
        c = new address[](a.length);
        for (uint256 i; i < a.length; ++i) {
            c[i] = a[i];
        }
    }
}
