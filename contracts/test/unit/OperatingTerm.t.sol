// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {RevenueDistributor} from "../../src/distribution/RevenueDistributor.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";

/// Operating term (OPERATING_TERM_PROPOSAL.md §4.1) and fee-free capital return at term end (§4.2).
contract OperatingTermTest is BaseTest {
    address[] internal holders;
    uint32[] internal units;

    function _activate() internal returns (uint64 snap) {
        uint32[2] memory u = [uint32(60), 40];
        for (uint256 i; i < u.length; ++i) {
            holders.push(makeAddr(string(abi.encodePacked("holder", vm.toString(i)))));
            units.push(u[i]);
        }
        _fundAndActivate(holders, units);
        snap = uint64(block.number - 1);
    }

    function _sortedHolders() internal view returns (address[] memory) {
        address[] memory h = new address[](holders.length);
        for (uint256 i; i < h.length; ++i) {
            h[i] = holders[i];
        }
        return _sorted(h);
    }

    function test_DefaultTermAppliedWhenOfferingOpens() public {
        (uint32 termDays,,) = assets.termOf(PID);
        assertEq(termDays, 0);
        _openOffering(100);
        (termDays,,) = assets.termOf(PID);
        assertEq(termDays, assets.DEFAULT_TERM_DAYS());
        assertEq(termDays, 720);
    }

    function test_CustomTermBeforeOffering() public {
        _deployProject();
        vm.prank(operator);
        assets.setOperatingTerm(PID, 360);
        vm.startPrank(gov);
        offering.configure(_defaultConfig(100));
        offering.open();
        vm.stopPrank();
        (uint32 termDays,,) = assets.termOf(PID);
        assertEq(termDays, 360);
    }

    function test_TermLockedOnceOfferingOpens() public {
        _openOffering(100);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                AssetRegistry.InvalidTransition.selector, ProjectState.OFFERING, ProjectState.OFFERING
            )
        );
        assets.setOperatingTerm(PID, 180);
    }

    function test_TermBounds() public {
        _registerAndVerify();
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidTerm.selector, uint32(0)));
        assets.setOperatingTerm(PID, 0);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.InvalidTerm.selector, uint32(3651)));
        assets.setOperatingTerm(PID, 3651);
        vm.stopPrank();
    }

    function test_SetTermOnlyOperator() public {
        _registerAndVerify();
        vm.expectRevert();
        assets.setOperatingTerm(PID, 360);
    }

    function test_ClockStartsOnActivationAndSurvivesSuspension() public {
        _activate();
        (uint32 termDays, uint64 startedAt, uint64 endsAt) = assets.termOf(PID);
        assertEq(startedAt, block.timestamp);
        assertEq(endsAt, startedAt + uint64(termDays) * 1 days);

        vm.warp(block.timestamp + 10 days);
        vm.prank(gov);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        (, uint64 startedAfter,) = assets.termOf(PID);
        assertEq(startedAfter, startedAt);
    }

    function test_CapitalReturnOnlyWhenWindingDown() public {
        uint64 snap = _activate();
        bytes32 reportId = _approvedReport(1_000 * ONE, 1, 2);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.ProjectStateInvalid.selector, ProjectState.ACTIVE));
        distributor.proposeCapitalReturnBatch(reportId, 1_000 * ONE, snap, _sortedHolders());
    }

    function test_CapitalReturnIsFeeFree() public {
        uint64 snap = _activate();
        vm.prank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);

        uint256 amount = 30_000 * ONE;
        bytes32 reportId = _approvedReport(amount, 3, 4);
        _fundTreasury(amount);
        uint256 feeBefore = usdt.balanceOf(feeRecipient);

        vm.prank(operator);
        uint256 id = distributor.proposeCapitalReturnBatch(reportId, amount, snap, _sortedHolders());
        vm.prank(reviewer);
        distributor.approveBatch(id);

        RevenueDistributor.Batch memory b = distributor.getBatch(id);
        assertTrue(b.capitalReturn);
        assertEq(b.totalFee, 0);
        assertEq(b.totalNet, amount);
        assertEq(usdt.balanceOf(feeRecipient), feeBefore);
        assertEq(distributor.allocationOf(id, holders[0]).net, 18_000 * ONE);
        assertEq(distributor.allocationOf(id, holders[0]).feeBps, 0);

        vm.prank(holders[1]);
        distributor.claim(id);
        assertEq(usdt.balanceOf(holders[1]), 12_000 * ONE);
    }

    function test_RegularBatchStillChargesFeeWhenWindingDown() public {
        uint64 snap = _activate();
        vm.prank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);
        uint256 amount = 1_000 * ONE;
        bytes32 reportId = _approvedReport(amount, 3, 4);
        _fundTreasury(amount);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(reportId, amount, snap, _sortedHolders());
        RevenueDistributor.Batch memory b = distributor.getBatch(id);
        assertFalse(b.capitalReturn);
        assertGt(b.totalFee, 0);
    }

    function test_CapitalReturnOnlyOperator() public {
        uint64 snap = _activate();
        vm.prank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);
        bytes32 reportId = _approvedReport(1_000 * ONE, 3, 4);
        address[] memory h = _sortedHolders();
        vm.expectRevert();
        distributor.proposeCapitalReturnBatch(reportId, 1_000 * ONE, snap, h);
    }
}
