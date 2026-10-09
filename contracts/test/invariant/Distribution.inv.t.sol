// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "../BaseTest.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {RevenueDistributor} from "../../src/distribution/RevenueDistributor.sol";
import {AuditRegistry} from "../../src/registry/AuditRegistry.sol";
import {MockUSDT} from "../mocks/MockUSDT.sol";
import {RecordKind} from "../../src/interfaces/IRoboShare.sol";

/// @dev Drives transfers, distributions and claims on an ACTIVE project.
contract DistributionHandler is Test {
    RwaShareToken internal token;
    RevenueDistributor internal distributor;
    AuditRegistry internal audit;
    MockUSDT internal usdt;
    address internal operator;
    address internal reviewer;
    address internal treasury;
    bytes32 internal pid;
    address[] public actors;
    uint64 internal nextPeriod = 10;
    uint256 public batches;

    constructor(
        RwaShareToken t,
        RevenueDistributor d,
        AuditRegistry a,
        MockUSDT u,
        address[] memory actors_,
        address op,
        address rev,
        address tre,
        bytes32 pid_
    ) {
        token = t;
        distributor = d;
        audit = a;
        usdt = u;
        actors = actors_;
        operator = op;
        reviewer = rev;
        treasury = tre;
        pid = pid_;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 bal = token.balanceOf(from);
        if (bal == 0 || from == to) return;
        amount = bound(amount, 1, bal);
        vm.prank(from);
        token.transfer(to, amount);
        vm.roll(block.number + 1);
    }

    function distribute(uint256 amount) external {
        amount = bound(amount, 1, 1e30);
        vm.roll(block.number + 1);
        uint64 snap = uint64(block.number - 1);

        uint256 count;
        address[] memory hs = new address[](actors.length);
        for (uint256 i; i < actors.length; ++i) {
            if (token.balanceOfAt(actors[i], snap) > 0) hs[count++] = actors[i];
        }
        assembly ("memory-safe") {
            mstore(hs, count)
        }
        _sort(hs);

        vm.prank(operator);
        bytes32 reportId = audit.submitRecord(
            AuditRegistry.RecordInput({
                projectId: pid,
                kind: RecordKind.FINANCIAL_REPORT,
                contentHash: keccak256(abi.encode(nextPeriod)),
                docType: "PNL_REPORT",
                offchainRef: 0,
                periodStart: nextPeriod,
                periodEnd: nextPeriod + 1,
                distributableAmount: amount,
                paymentToken: address(usdt)
            })
        );
        nextPeriod += 2;
        vm.prank(reviewer);
        audit.approve(reportId);
        usdt.mint(treasury, amount);
        vm.prank(treasury);
        usdt.approve(address(distributor), amount);
        vm.prank(operator);
        uint256 id = distributor.proposeBatch(reportId, amount, snap, hs);
        vm.prank(reviewer);
        distributor.approveBatch(id);
        batches = id;
    }

    function claim(uint256 actorSeed, uint256 batchSeed) external {
        if (batches == 0) return;
        address who = actors[actorSeed % actors.length];
        uint256 id = bound(batchSeed, 1, batches);
        RevenueDistributor.Allocation memory a = distributor.allocationOf(id, who);
        if (a.claimed || a.net == 0) return;
        vm.prank(who);
        distributor.claim(id);
    }

    function _sort(address[] memory a) private pure {
        for (uint256 i = 1; i < a.length; ++i) {
            address key = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > key) {
                a[j] = a[j - 1];
                --j;
            }
            a[j] = key;
        }
    }
}

contract DistributionInvariantTest is BaseTest {
    DistributionHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[] memory hs = new address[](5);
        uint32[] memory us = new uint32[](5);
        uint32[5] memory split = [uint32(40), 30, 15, 10, 5];
        for (uint256 i; i < 5; ++i) {
            hs[i] = makeAddr(string(abi.encodePacked("inv", vm.toString(i))));
            us[i] = split[i];
        }
        _fundAndActivate(hs, us);
        handler = new DistributionHandler(token, distributor, audit, usdt, hs, operator, reviewer, treasury, PID);
        targetContract(address(handler));
    }

    /// Required invariant: the distributor holds exactly what holders can still claim plus dust.
    function invariant_DistributorSolvent() public view {
        assertEq(usdt.balanceOf(address(distributor)), distributor.totalUnclaimed() + distributor.carriedDust());
    }

    function invariant_SupplyFixedAtIssued() public view {
        assertEq(token.totalSupply(), 100);
        assertLe(token.totalSupply(), token.CAP());
    }

    function invariant_RouterHoldsNothing() public view {
        assertEq(usdt.balanceOf(address(router)), 0);
    }
}
