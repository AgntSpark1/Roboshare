// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ShareMarket} from "../../src/market/ShareMarket.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";
import {DeployShareMarket} from "../../script/DeployShareMarket.s.sol";

contract ShareMarketTest is BaseTest {
    address internal alice = makeAddr("alice"); // seller
    address internal bob = makeAddr("bob"); // buyer
    address internal platform = makeAddr("platformBuyer"); // platform's own eligible wallet

    uint256 internal constant PRICE = 900 * ONE; // seller accepts a discount to exit early

    ShareMarket internal market;

    function setUp() public override {
        super.setUp();
        address[] memory h = new address[](1);
        uint32[] memory u = new uint32[](1);
        h[0] = alice;
        u[0] = 20;
        _fundAndActivate(h, u);
        market = new ShareMarket(IERC20(address(usdt)), assets, gov, pauser);
        _makeEligible(bob);
        _makeEligible(platform);
        vm.prank(alice);
        token.approve(address(market), type(uint256).max);
    }

    function _list(uint32 units) internal returns (uint256 id) {
        vm.prank(alice);
        id = market.list(PID, units, PRICE, uint64(block.timestamp + 7 days));
    }

    function _fundBuyer(address buyer, uint256 amount) internal {
        usdt.mint(buyer, amount);
        vm.prank(buyer);
        usdt.approve(address(market), type(uint256).max);
    }

    function test_ListAndBuy_SwapsUsdtAndUnits() public {
        uint256 id = _list(10);
        _fundBuyer(bob, 4 * PRICE);
        uint256 aliceBefore = usdt.balanceOf(alice);

        vm.expectEmit(address(market));
        emit ShareMarket.Purchased(id, PID, bob, alice, 4, PRICE, 4 * PRICE);
        vm.prank(bob);
        market.buy(id, 4, PRICE);

        assertEq(token.balanceOf(bob), 4);
        assertEq(token.balanceOf(alice), 16);
        assertEq(usdt.balanceOf(bob), 0);
        assertEq(usdt.balanceOf(alice) - aliceBefore, 4 * PRICE);
        assertEq(market.getListing(id).units, 6);
        assertEq(market.fillable(id), 6);
        // Market never holds anything.
        assertEq(usdt.balanceOf(address(market)), 0);
        assertEq(token.balanceOf(address(market)), 0);
    }

    function test_PlatformBuysLikeAnyBuyer() public {
        uint256 id = _list(10);
        _fundBuyer(platform, 10 * PRICE);
        vm.prank(platform);
        market.buy(id, 10, PRICE);
        assertEq(token.balanceOf(platform), 10);
        assertEq(market.getListing(id).units, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.ListingInactive.selector, id));
        market.buy(id, 1, PRICE);
    }

    function test_RevertWhen_BuyerNotEligible() public {
        uint256 id = _list(5);
        _fundBuyer(attacker, PRICE);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.NotEligible.selector, attacker));
        market.buy(id, 1, PRICE);
        // Nothing moved.
        assertEq(usdt.balanceOf(attacker), PRICE);
        assertEq(market.getListing(id).units, 5);
    }

    function test_RevertWhen_SellerFrozen() public {
        uint256 id = _list(5);
        _fundBuyer(bob, PRICE);
        vm.prank(agent);
        identity.freeze(alice, "x");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.SenderFrozen.selector, alice));
        market.buy(id, 1, PRICE);
    }

    function test_RevertWhen_ProjectSuspended() public {
        uint256 id = _list(5);
        _fundBuyer(bob, PRICE);
        vm.prank(pauser);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.TransfersDisabledInState.selector, ProjectState.SUSPENDED));
        market.buy(id, 1, PRICE);
    }

    function test_RevertWhen_PriceRaisedAboveBuyerMax() public {
        uint256 id = _list(5);
        _fundBuyer(bob, 10 * PRICE);
        vm.prank(alice);
        market.updateListing(id, 5, 2 * PRICE, uint64(block.timestamp + 7 days));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.PriceAboveMax.selector, 2 * PRICE, PRICE));
        market.buy(id, 1, PRICE);
    }

    function test_RevertWhen_MoreThanListed() public {
        uint256 id = _list(3);
        _fundBuyer(bob, 10 * PRICE);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.InsufficientUnits.selector, 4, 3));
        market.buy(id, 4, PRICE);
    }

    function test_RevertWhen_Expired() public {
        uint256 id = _list(3);
        _fundBuyer(bob, PRICE);
        vm.warp(block.timestamp + 7 days);
        assertEq(market.fillable(id), 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.ListingExpired.selector, id));
        market.buy(id, 1, PRICE);
    }

    function test_RevertWhen_SellerNoLongerHoldsUnits() public {
        uint256 id = _list(20);
        vm.prank(alice);
        token.transfer(bob, 15);
        assertEq(market.fillable(id), 5);
        _fundBuyer(platform, 20 * PRICE);
        vm.prank(platform);
        vm.expectRevert();
        market.buy(id, 6, PRICE);
    }

    function test_FillableCappedByAllowance() public {
        uint256 id = _list(10);
        vm.prank(alice);
        token.approve(address(market), 2);
        assertEq(market.fillable(id), 2);
    }

    function test_RevertWhen_SelfPurchase() public {
        uint256 id = _list(3);
        _makeEligible(alice);
        _fundBuyer(alice, PRICE);
        vm.prank(alice);
        vm.expectRevert(ShareMarket.SelfPurchase.selector);
        market.buy(id, 1, PRICE);
    }

    function test_CancelOnlyBySeller_EvenWhenPaused() public {
        uint256 id = _list(3);
        vm.prank(bob);
        vm.expectRevert(ShareMarket.NotSeller.selector);
        market.cancel(id);
        vm.prank(pauser);
        market.pause();
        vm.prank(alice);
        market.cancel(id);
        assertEq(market.getListing(id).units, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.ListingInactive.selector, id));
        market.cancel(id);
    }

    function test_RevertWhen_UpdateByOther() public {
        uint256 id = _list(3);
        vm.prank(bob);
        vm.expectRevert(ShareMarket.NotSeller.selector);
        market.updateListing(id, 1, PRICE, uint64(block.timestamp + 1 days));
    }

    function test_PauseBlocksListAndBuy() public {
        uint256 id = _list(3);
        _fundBuyer(bob, PRICE);
        vm.prank(pauser);
        market.pause();
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.buy(id, 1, PRICE);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.list(PID, 1, PRICE, uint64(block.timestamp + 1 days));
        vm.prank(pauser);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, bytes32(0))
        );
        market.unpause();
        vm.prank(gov);
        market.unpause();
        vm.prank(bob);
        market.buy(id, 1, PRICE);
    }

    function test_RevertWhen_BadListingTerms() public {
        vm.startPrank(alice);
        vm.expectRevert(ShareMarket.ZeroValue.selector);
        market.list(PID, 0, PRICE, uint64(block.timestamp + 1 days));
        vm.expectRevert(ShareMarket.ZeroValue.selector);
        market.list(PID, 1, 0, uint64(block.timestamp + 1 days));
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.InvalidExpiry.selector, uint64(block.timestamp)));
        market.list(PID, 1, PRICE, uint64(block.timestamp));
        bytes32 unknown = keccak256("unknown");
        vm.expectRevert(abi.encodeWithSelector(ShareMarket.TokenNotLinked.selector, unknown));
        market.list(unknown, 1, PRICE, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_RevertWhen_ZeroUnitsBought() public {
        uint256 id = _list(3);
        vm.prank(bob);
        vm.expectRevert(ShareMarket.ZeroValue.selector);
        market.buy(id, 0, PRICE);
    }

    function test_ConstructorRejectsZero() public {
        vm.expectRevert(ShareMarket.ZeroValue.selector);
        new ShareMarket(IERC20(address(0)), assets, gov, pauser);
    }

    function test_DeployScriptGivesAdminToSafeOnly() public {
        DeployShareMarket script = new DeployShareMarket();
        ShareMarket m = script.deploy(address(usdt), address(assets), gov, pauser);
        assertTrue(m.hasRole(m.DEFAULT_ADMIN_ROLE(), gov));
        assertFalse(m.hasRole(m.DEFAULT_ADMIN_ROLE(), address(script)));
        assertTrue(m.hasRole(m.PAUSER_ROLE(), pauser));
    }

    function testFuzz_BuyConservesUnitsAndUsdt(uint32 listed, uint32 bought) public {
        listed = uint32(bound(listed, 1, 20));
        bought = uint32(bound(bought, 1, listed));
        uint256 id = _list(listed);
        _fundBuyer(bob, uint256(bought) * PRICE);
        uint256 aliceUsdt = usdt.balanceOf(alice);
        vm.prank(bob);
        market.buy(id, bought, PRICE);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), 20);
        assertEq(usdt.balanceOf(alice) - aliceUsdt, uint256(bought) * PRICE);
        assertEq(market.getListing(id).units, listed - bought);
    }
}
