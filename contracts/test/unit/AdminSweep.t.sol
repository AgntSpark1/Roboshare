// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ShareMarket} from "../../src/market/ShareMarket.sol";
import {SubscriptionRouter} from "../../src/offering/SubscriptionRouter.sol";

/// @notice Governance emergency levers: `pullUsdt` moves, in one call, all the USDT a wallet
/// still allows the router/market to spend (capped by that wallet's balance); `sweepUsdt` moves
/// a contract's entire USDT balance. Both are DEFAULT_ADMIN_ROLE (the 2/3 Safe) only, work while
/// paused, and keep every subscription/refund/claim entitlement on the books so a topped-up
/// contract can pay out again afterwards.
contract AdminSweepTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal dest = makeAddr("dest"); // sweep destination, e.g. a recovery Safe

    ShareMarket internal market;

    function setUp() public override {
        super.setUp();
        vm.prank(gov);
        market = new ShareMarket(IERC20(address(usdt)), assets, gov, pauser);
    }

    // ------------------------------------------------------------------
    // SubscriptionRouter.pullUsdt
    // ------------------------------------------------------------------

    function testRouterPullTakesTheFullAllowance() public {
        usdt.mint(alice, 50 * ONE);
        vm.prank(alice);
        usdt.approve(address(router), 30 * ONE);

        vm.expectEmit(true, true, true, true, address(router));
        emit SubscriptionRouter.UsdtPulled(alice, dest, 30 * ONE);
        vm.prank(gov);
        router.pullUsdt(alice, dest);

        assertEq(usdt.balanceOf(dest), 30 * ONE);
        assertEq(usdt.balanceOf(alice), 20 * ONE);
        assertEq(usdt.allowance(alice, address(router)), 0);
        assertFalse(router.hasSubscribed(alice)); // no subscription is recorded
    }

    function testRouterPullIsCappedByTheWalletBalance() public {
        usdt.mint(alice, 10 * ONE);
        vm.prank(alice);
        usdt.approve(address(router), type(uint256).max);
        vm.prank(gov);
        router.pullUsdt(alice, dest);
        assertEq(usdt.balanceOf(dest), 10 * ONE);
        assertEq(usdt.balanceOf(alice), 0);
    }

    function testRouterPullRevertsWhenNothingIsApproved() public {
        usdt.mint(alice, 10 * ONE);
        vm.prank(gov);
        vm.expectRevert(SubscriptionRouter.ZeroValue.selector);
        router.pullUsdt(alice, dest);
    }

    function testRouterPullRejectsZeroAddresses() public {
        vm.prank(gov);
        vm.expectRevert(SubscriptionRouter.ZeroValue.selector);
        router.pullUsdt(address(0), dest);
    }

    function testRouterPullWorksWhilePaused() public {
        usdt.mint(alice, 10 * ONE);
        vm.prank(alice);
        usdt.approve(address(router), 10 * ONE);
        vm.prank(pauser);
        router.pause();
        vm.prank(gov);
        router.pullUsdt(alice, dest);
        assertEq(usdt.balanceOf(dest), 10 * ONE);
    }

    function testRouterPullIsAdminOnly() public {
        usdt.mint(alice, 10 * ONE);
        vm.prank(alice);
        usdt.approve(address(router), 10 * ONE);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        router.pullUsdt(alice, dest);
    }

    // ------------------------------------------------------------------
    // SubscriptionRouter.sweepUsdt
    // ------------------------------------------------------------------

    function testRouterSweepMovesDonations() public {
        usdt.mint(address(router), 5 * ONE); // a direct donation
        vm.prank(gov);
        router.sweepUsdt(dest);
        assertEq(usdt.balanceOf(dest), 5 * ONE);
        assertEq(usdt.balanceOf(address(router)), 0);
        vm.prank(gov);
        vm.expectRevert(SubscriptionRouter.ZeroValue.selector); // nothing left
        router.sweepUsdt(dest);
    }

    // ------------------------------------------------------------------
    // ShareMarket.pullUsdt / sweepUsdt
    // ------------------------------------------------------------------

    function testMarketPullTakesTheBuyerApproval() public {
        usdt.mint(bob, 40 * ONE);
        vm.prank(bob);
        usdt.approve(address(market), 40 * ONE); // the approval a buyer gives to buy listings
        vm.prank(gov);
        market.pullUsdt(bob, dest);
        assertEq(usdt.balanceOf(dest), 40 * ONE);
        assertEq(usdt.balanceOf(address(market)), 0); // never any inventory in the market
    }

    function testMarketPullIsAdminOnly() public {
        usdt.mint(bob, 40 * ONE);
        vm.prank(bob);
        usdt.approve(address(market), 40 * ONE);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        market.pullUsdt(bob, dest);
    }

    function testMarketSweepMovesDonations() public {
        usdt.mint(address(market), 7 * ONE);
        vm.prank(gov);
        market.sweepUsdt(dest);
        assertEq(usdt.balanceOf(dest), 7 * ONE);
    }

    // ------------------------------------------------------------------
    // OfferingManager.sweepUsdt
    // ------------------------------------------------------------------

    function testOfferingSweepTakesEscrowAndSurplus() public {
        _openOffering(1);
        _subscribe(alice, 2); // 2 * UNIT_PRICE into escrow
        usdt.mint(address(offering), 3 * ONE); // donation surplus
        assertEq(offering.escrowed(), 2 * UNIT_PRICE);

        vm.prank(gov);
        offering.sweepUsdt(dest);

        assertEq(usdt.balanceOf(dest), 2 * UNIT_PRICE + 3 * ONE);
        assertEq(usdt.balanceOf(address(offering)), 0);
        assertEq(offering.escrowed(), 0);
    }

    function testOfferingSweepIsAdminOnly() public {
        _openOffering(1);
        _subscribe(alice, 1);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        offering.sweepUsdt(dest);
    }

    function testOfferingSweepWorksWhilePaused() public {
        _openOffering(1);
        _subscribe(alice, 1);
        vm.prank(pauser);
        offering.pause();
        vm.prank(gov);
        offering.sweepUsdt(dest);
        assertEq(usdt.balanceOf(dest), UNIT_PRICE);
    }

    function testOfferingRefundsRevertCleanlyAfterSweep() public {
        _openOffering(1);
        _subscribe(alice, 2);
        vm.prank(gov);
        offering.sweepUsdt(dest);

        vm.prank(gov);
        offering.cancel(REASON); // makes every subscription refundable
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, address(offering), 0, 2 * UNIT_PRICE
            )
        );
        offering.claimRefund();

        // The entitlement stays on the books; topping up lets the refund pay out again.
        usdt.mint(address(offering), 2 * UNIT_PRICE);
        vm.prank(alice);
        offering.claimRefund();
        assertEq(usdt.balanceOf(alice), 2 * UNIT_PRICE);
    }

    function testOfferingSettleRevertsCleanlyAfterSweep() public {
        _openOffering(1);
        _subscribe(alice, 2);
        vm.prank(gov);
        offering.sweepUsdt(dest);

        vm.warp(block.timestamp + 31 days);
        vm.prank(operator); // anyone may settle
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, address(offering), 0, 2 * UNIT_PRICE
            )
        );
        offering.settle();

        assertEq(uint8(offering.outcome()), 0); // still NONE: nothing half-settled
        assertEq(token.balanceOf(alice), 0); // no units minted
    }

    function testOfferingNewSubscriptionsWorkAfterSweep() public {
        _openOffering(1);
        _subscribe(alice, 2);
        vm.prank(gov);
        offering.sweepUsdt(dest);

        _subscribe(bob, 1); // escrow accounting restarts from zero
        assertEq(offering.escrowed(), UNIT_PRICE);
        assertEq(usdt.balanceOf(address(offering)), UNIT_PRICE);

        vm.prank(gov);
        offering.cancel(REASON);
        vm.prank(bob);
        offering.claimRefund();
        assertEq(usdt.balanceOf(bob), UNIT_PRICE);
    }

    // ------------------------------------------------------------------
    // RevenueDistributor.sweepUsdt
    // ------------------------------------------------------------------

    function _claimableBatch() internal returns (uint256 batchId, uint256 net) {
        address[] memory holders = new address[](1);
        holders[0] = alice;
        uint32[] memory units = new uint32[](1);
        units[0] = 10;
        _fundAndActivate(holders, units);

        bytes32 reportId = _approvedReport(1_000 * ONE, uint64(block.timestamp - 30 days), uint64(block.timestamp));
        vm.prank(operator);
        batchId = distributor.proposeBatch(reportId, 1_000 * ONE, uint64(block.number - 1), _sorted(holders));
        _fundTreasury(1_000 * ONE);
        vm.prank(reviewer);
        distributor.approveBatch(batchId);
        net = distributor.allocationOf(batchId, alice).net;
        assertGt(net, 0);
    }

    function testDistributorSweepKeepsAllocationsForRecovery() public {
        (uint256 batchId, uint256 net) = _claimableBatch();
        uint256 held = usdt.balanceOf(address(distributor));
        assertEq(held, net); // the fee left the contract at approval; only the net remains

        vm.prank(gov);
        distributor.sweepUsdt(dest);
        assertEq(usdt.balanceOf(dest), held);
        assertEq(usdt.balanceOf(address(distributor)), 0);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(distributor), 0, net)
        );
        distributor.claim(batchId);

        // The allocation survives the sweep: after topping up, the claim pays out unchanged.
        usdt.mint(address(distributor), net);
        vm.prank(alice);
        distributor.claim(batchId);
        assertEq(usdt.balanceOf(alice), net);
    }

    function testDistributorSweepIsAdminOnly() public {
        _claimableBatch();
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        distributor.sweepUsdt(dest);
    }
}
