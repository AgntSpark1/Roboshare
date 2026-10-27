// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RevenueDistributor} from "../../src/distribution/RevenueDistributor.sol";
import {AuditRegistry} from "../../src/registry/AuditRegistry.sol";
import {SubscriptionRouter} from "../../src/offering/SubscriptionRouter.sol";
import {ProjectFactory} from "../../src/factory/ProjectFactory.sol";
import {ProjectState, RecordKind} from "../../src/interfaces/IRoboShare.sol";
import {MockReentrantToken, IReentryTarget} from "../mocks/MockUSDT.sol";

contract RevenueDistributorTest is BaseTest {
    address[] internal holders;
    uint32[] internal units;
    uint64 internal snap;

    function setUp() public override {
        super.setUp();
        // TOKENOMICS §4.4 holder mix: 50, 25, 10, 9, 4, 2.
        uint32[6] memory u = [uint32(50), 25, 10, 9, 4, 2];
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

    function _proposeAndApprove(uint256 amount) internal returns (uint256 id, bytes32 reportId) {
        reportId = _approvedReport(amount, 1, 2);
        _fundTreasury(amount);
        vm.prank(operator);
        id = distributor.proposeBatch(reportId, amount, snap, _sortedHolders());
        vm.prank(reviewer);
        distributor.approveBatch(id);
    }

    /// Required test 7: allocation calculations (TOKENOMICS §4.4 worked example).
    function test_TokenomicsWorkedExample() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        uint256[6] memory expectedNet =
            [uint256(3_500 * ONE), 1_750 * ONE, 700 * ONE, 630 * ONE, 280 * ONE, 140 * ONE];
        for (uint256 i; i < holders.length; ++i) {
            assertEq(distributor.allocationOf(id, holders[i]).net, expectedNet[i], "net");
        }
        RevenueDistributor.Batch memory b = distributor.getBatch(id);
        assertEq(b.totalNet, 7_000 * ONE);
        assertEq(b.totalFee, 3_000 * ONE);
        assertEq(b.dustOut, 0);
        assertEq(usdt.balanceOf(feeRecipient), 3_000 * ONE);
        assertEq(usdt.balanceOf(address(distributor)), 7_000 * ONE);
    }

    /// 10 of 100 units, flat 30% platform share, D = 10,000 -> 700.
    function test_MasterPromptExample() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        assertEq(distributor.allocationOf(id, holders[2]).net, 700 * ONE);
        assertEq(distributor.allocationOf(id, holders[2]).feeBps, 3000);
    }

    function test_FlatPlatformShareForEveryHolding() public view {
        assertEq(distributor.tierBpsFor(1), 3000);
        assertEq(distributor.tierBpsFor(9), 3000);
        assertEq(distributor.tierBpsFor(50), 3000);
        assertEq(distributor.tierBpsFor(100), 3000);
    }

    function test_ClaimOnceOnly() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        vm.prank(holders[0]);
        distributor.claim(id);
        assertEq(usdt.balanceOf(holders[0]), 3_500 * ONE);
        vm.prank(holders[0]);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.AlreadyClaimed.selector, id, holders[0]));
        distributor.claim(id);
    }

    function test_RevertWhen_NonHolderClaims() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.NothingToClaim.selector, id, attacker));
        distributor.claim(id);
    }

    function test_ClaimForSendsToHolder() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        vm.prank(operator);
        distributor.claimFor(id, holders[1]);
        assertEq(usdt.balanceOf(holders[1]), 1_750 * ONE);
        assertEq(usdt.balanceOf(operator), 0);
    }

    /// D-13: frozen wallets keep their entitlement and claim after unfreeze.
    function test_FrozenHolderClaimsAfterUnfreeze() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        vm.prank(agent);
        identity.freeze(holders[3], "SANCTIONS");
        vm.prank(holders[3]);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.HolderFrozen.selector, holders[3]));
        distributor.claim(id);
        vm.prank(gov);
        identity.unfreeze(holders[3]);
        vm.prank(holders[3]);
        distributor.claim(id);
        assertEq(usdt.balanceOf(holders[3]), 630 * ONE);
    }

    /// Required test 6: duplicate distribution batches.
    function test_RevertWhen_BatchExceedsReport() public {
        (, bytes32 reportId) = _proposeAndApprove(10_000 * ONE);
        _fundTreasury(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.AmountExceedsReport.selector, 1, 0));
        distributor.proposeBatch(reportId, 1, snap, _sortedHolders());
    }

    function test_SplitBatchesUpToReportAmount() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        _fundTreasury(10_000 * ONE);
        vm.startPrank(operator);
        uint256 id1 = distributor.proposeBatch(reportId, 6_000 * ONE, snap, _sortedHolders());
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.BatchPending.selector, id1));
        distributor.proposeBatch(reportId, 4_000 * ONE, snap, _sortedHolders());
        vm.stopPrank();
        vm.prank(reviewer);
        distributor.approveBatch(id1);
        vm.prank(operator);
        uint256 id2 = distributor.proposeBatch(reportId, 4_000 * ONE, snap, _sortedHolders());
        vm.prank(reviewer);
        distributor.approveBatch(id2);
        assertEq(distributor.distributedForPeriod(audit.periodKey(1, 2)), 10_000 * ONE);
    }

    /// Required test 9: empty or zero-value batches.
    function test_RevertWhen_ZeroOrEmptyBatch() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        vm.startPrank(operator);
        vm.expectRevert(RevenueDistributor.ZeroValue.selector);
        distributor.proposeBatch(reportId, 0, snap, _sortedHolders());
        vm.expectRevert(RevenueDistributor.ZeroValue.selector);
        distributor.proposeBatch(reportId, 1, snap, new address[](0));
        vm.stopPrank();
    }

    function test_RevertWhen_HolderSetIncompleteUnsortedOrDuplicated() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        address[] memory h = _sortedHolders();

        address[] memory missing = new address[](h.length - 1);
        for (uint256 i; i < missing.length; ++i) {
            missing[i] = h[i];
        }
        vm.startPrank(operator);
        vm.expectRevert();
        distributor.proposeBatch(reportId, ONE, snap, missing);

        address[] memory dup = new address[](h.length + 1);
        for (uint256 i; i < h.length; ++i) {
            dup[i] = h[i];
        }
        dup[h.length] = h[h.length - 1];
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.HoldersNotSorted.selector, h[h.length - 1]));
        distributor.proposeBatch(reportId, ONE, snap, dup);

        (h[0], h[1]) = (h[1], h[0]);
        vm.expectRevert();
        distributor.proposeBatch(reportId, ONE, snap, h);
        vm.stopPrank();
    }

    function test_RevertWhen_SnapshotInFutureOrBeforeFunding() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.SnapshotOutOfRange.selector, block.number));
        distributor.proposeBatch(reportId, ONE, uint64(block.number), _sortedHolders());
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.SnapshotOutOfRange.selector, 1));
        distributor.proposeBatch(reportId, ONE, 1, _sortedHolders());
        vm.stopPrank();
    }

    /// Required test 15: unverified reports cannot fund a batch.
    function test_RevertWhen_ReportNotApprovedOrWrongProject() public {
        vm.prank(operator);
        bytes32 pending = audit.submitRecord(
            AuditRegistry.RecordInput({
                projectId: PID,
                kind: RecordKind.FINANCIAL_REPORT,
                contentHash: keccak256("pending"),
                docType: "PNL_REPORT",
                offchainRef: 0,
                periodStart: 1,
                periodEnd: 2,
                distributableAmount: 10_000 * ONE,
                paymentToken: address(usdt)
            })
        );
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.ReportNotApproved.selector, pending));
        distributor.proposeBatch(pending, ONE, snap, _sortedHolders());

        vm.prank(operator);
        bytes32 doc = audit.submitRecord(
            AuditRegistry.RecordInput({
                projectId: PID,
                kind: RecordKind.DOCUMENT,
                contentHash: keccak256("insurance"),
                docType: "INSURANCE_POLICY",
                offchainRef: 0,
                periodStart: 0,
                periodEnd: 0,
                distributableAmount: 0,
                paymentToken: address(0)
            })
        );
        vm.prank(reviewer);
        audit.approve(doc);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.ReportMismatch.selector, doc));
        distributor.proposeBatch(doc, ONE, snap, _sortedHolders());
    }

    function test_RevertWhen_ReportSupersededBeforeApproval() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        _fundTreasury(10_000 * ONE);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(reportId, 10_000 * ONE, snap, _sortedHolders());

        AuditRegistry.RecordInput memory amended = AuditRegistry.RecordInput({
            projectId: PID,
            kind: RecordKind.FINANCIAL_REPORT,
            contentHash: keccak256("amended"),
            docType: "PNL_REPORT",
            offchainRef: 0,
            periodStart: 1,
            periodEnd: 2,
            distributableAmount: 5_000 * ONE,
            paymentToken: address(usdt)
        });
        vm.prank(operator);
        bytes32 newId = audit.submitAmendment(reportId, amended);
        vm.prank(reviewer);
        audit.approve(newId);

        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.ReportNotApproved.selector, reportId));
        distributor.approveBatch(id);
    }

    function test_RevertWhen_ProposerApproves() public {
        vm.startPrank(gov);
        distributor.grantRole(distributor.REVIEWER_ROLE(), operator);
        vm.stopPrank();
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        vm.startPrank(operator);
        uint256 id = distributor.proposeBatch(reportId, ONE, snap, _sortedHolders());
        vm.expectRevert(RevenueDistributor.SelfApproval.selector);
        distributor.approveBatch(id);
        vm.stopPrank();
    }

    function test_RejectedBatchMovesNoFunds() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        _fundTreasury(10_000 * ONE);
        uint256 before = usdt.balanceOf(treasury);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(reportId, 10_000 * ONE, snap, _sortedHolders());
        vm.prank(reviewer);
        distributor.rejectBatch(id, REASON);
        assertEq(usdt.balanceOf(treasury), before);
        assertEq(usdt.balanceOf(address(distributor)), 0);
        vm.prank(holders[0]);
        vm.expectRevert(abi.encodeWithSelector(RevenueDistributor.NotClaimable.selector, id));
        distributor.claim(id);
        assertFalse(distributor.hasPendingBatch());
    }

    /// Required test 8: rounding dust is carried into the next batch.
    function test_DustCarriedForward() public {
        // 7 base units over 100 units with holders 50/25/10/9/4/2 leaves dust.
        (uint256 id1,) = _proposeAndApprove(7);
        RevenueDistributor.Batch memory b1 = distributor.getBatch(id1);
        assertGt(b1.dustOut, 0);
        assertEq(b1.totalNet + b1.totalFee + b1.dustOut, b1.pool);
        assertEq(distributor.carriedDust(), b1.dustOut);

        bytes32 r2 = _approvedReport(1_000 * ONE, 3, 4);
        _fundTreasury(1_000 * ONE);
        vm.prank(operator);
        uint256 id2 = distributor.proposeBatch(r2, 1_000 * ONE, snap, _sortedHolders());
        RevenueDistributor.Batch memory b2 = distributor.getBatch(id2);
        assertEq(b2.carriedDustIn, b1.dustOut);
        assertEq(b2.pool, 1_000 * ONE + b1.dustOut);
    }

    function test_SweepDustOnlyWhenClosed() public {
        _proposeAndApprove(7);
        vm.prank(gov);
        vm.expectRevert(RevenueDistributor.ProjectNotClosed.selector);
        distributor.sweepDust();
        vm.startPrank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);
        assets.transition(PID, ProjectState.CLOSED, REASON);
        uint256 dust = distributor.carriedDust();
        uint256 before = usdt.balanceOf(treasury);
        distributor.sweepDust();
        vm.stopPrank();
        assertEq(usdt.balanceOf(treasury) - before, dust);
        assertEq(distributor.carriedDust(), 0);
    }

    function test_CannotCloseWithPendingBatch() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        vm.prank(operator);
        distributor.proposeBatch(reportId, ONE, snap, _sortedHolders());
        vm.startPrank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);
        vm.expectRevert();
        assets.transition(PID, ProjectState.CLOSED, REASON);
        vm.stopPrank();
    }

    function test_SnapshotIgnoresLaterTransfers() public {
        address newcomer = makeAddr("newcomer");
        vm.prank(holders[0]);
        token.transfer(newcomer, 50); // after the snapshot block
        vm.roll(block.number + 1);
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        assertEq(distributor.allocationOf(id, holders[0]).net, 3_500 * ONE);
        assertEq(distributor.allocationOf(id, newcomer).net, 0);
    }

    /// Required test 12: paused distributor.
    function test_PausedBlocksClaims() public {
        (uint256 id,) = _proposeAndApprove(10_000 * ONE);
        vm.prank(pauser);
        distributor.pause();
        vm.prank(holders[0]);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        distributor.claim(id);
    }

    /// Required test 11: unauthorized administration.
    function test_RevertWhen_UnauthorizedBatchActions() public {
        bytes32 reportId = _approvedReport(10_000 * ONE, 1, 2);
        vm.startPrank(attacker);
        vm.expectRevert();
        distributor.proposeBatch(reportId, ONE, snap, _sortedHolders());
        vm.expectRevert();
        distributor.approveBatch(1);
        vm.expectRevert();
        distributor.sweepDust();
        vm.expectRevert();
        distributor.claimFor(1, attacker);
        vm.stopPrank();
    }
}

/// Required test 16: reentrancy through a malicious payment token.
contract ReentrancyTest is BaseTest, IReentryTarget {
    MockReentrantToken internal evil;
    uint256 internal batchId;
    bool internal armed;

    function reenter() external {
        if (!armed) return;
        armed = false;
        distributor.claim(batchId);
    }

    function test_RevertWhen_ClaimReentered() public {
        evil = new MockReentrantToken();
        router = new SubscriptionRouter(IERC20(address(evil)), assets, gov, pauser);
        factory = new ProjectFactory(
            assets,
            audit,
            identity,
            router,
            factory.tokenDeployer(),
            factory.offeringDeployer(),
            factory.distributorDeployer(),
            ProjectFactory.Roles({
                admin: gov, operator: operator, reviewer: reviewer, pauser: pauser, feeRecipient: feeRecipient
            }),
            gov
        );
        vm.startPrank(gov);
        assets.grantRole(assets.FACTORY_ROLE(), address(factory));
        vm.stopPrank();

        // This contract is the only holder.
        _openOffering(100);
        evil.mint(address(this), 100 * UNIT_PRICE);
        evil.approve(address(router), type(uint256).max);
        router.subscribe(PID, 100, 100 * UNIT_PRICE);
        vm.warp(block.timestamp + 31 days);
        vm.prank(operator);
        offering.settle();
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        vm.roll(block.number + 1);

        vm.prank(operator);
        bytes32 reportId = audit.submitRecord(
            AuditRegistry.RecordInput({
                projectId: PID,
                kind: RecordKind.FINANCIAL_REPORT,
                contentHash: keccak256("r"),
                docType: "PNL_REPORT",
                offchainRef: 0,
                periodStart: 1,
                periodEnd: 2,
                distributableAmount: 1_000 * ONE,
                paymentToken: address(evil)
            })
        );
        vm.prank(reviewer);
        audit.approve(reportId);
        evil.mint(treasury, 1_000 * ONE);
        vm.prank(treasury);
        evil.approve(address(distributor), 1_000 * ONE);
        address[] memory h = new address[](1);
        h[0] = address(this);
        vm.prank(operator);
        batchId = distributor.proposeBatch(reportId, 1_000 * ONE, uint64(block.number - 1), h);
        vm.prank(reviewer);
        distributor.approveBatch(batchId);

        evil.setHook(address(this));
        armed = true;
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        distributor.claim(batchId);
    }
}
