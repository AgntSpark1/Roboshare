// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import {BaseTest} from "../BaseTest.sol";
import {SubscriptionRouter} from "../../src/offering/SubscriptionRouter.sol";
import {ReferralRewards} from "../../src/referral/ReferralRewards.sol";

contract ReferralBindingTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public override {
        super.setUp();
        _openOffering(1);
        _subscribe(alice, 1); // alice is an existing investor and can refer
    }

    function _enable() internal {
        vm.prank(gov);
        router.setReferralTerms(true, 2_000, 365 days);
    }

    function _subscribeRef(address investor, uint32 units, address referrer) internal {
        _fund(investor, units);
        vm.prank(investor);
        router.subscribeWithReferrer(PID, units, uint256(units) * UNIT_PRICE, referrer);
    }

    function _fund(address investor, uint32 units) internal {
        usdt.mint(investor, uint256(units) * UNIT_PRICE);
        vm.prank(investor);
        usdt.approve(address(router), type(uint256).max);
    }

    function test_DisabledByDefault() public {
        assertFalse(router.referralsEnabled());
        assertEq(router.referralShareBps(), 2_000);
        assertEq(router.referralWindow(), 365 days);
        _subscribeRef(bob, 2, alice);
        assertEq(router.referrerOf(bob), address(0));
        assertEq(offering.unitsOf(bob), 2); // the purchase itself still goes through
    }

    function test_BindsOnFirstSubscription() public {
        _enable();
        _fund(bob, 2);
        vm.expectEmit(true, true, false, true, address(router));
        emit SubscriptionRouter.ReferralBound(bob, alice, 2_000, uint64(block.timestamp + 365 days));
        vm.prank(bob);
        router.subscribeWithReferrer(PID, 2, 2 * UNIT_PRICE, alice);
        assertEq(router.referrerOf(bob), alice);
        assertEq(offering.unitsOf(bob), 2);
        assertEq(usdt.balanceOf(address(offering)), 3 * UNIT_PRICE); // money flow unchanged
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_BindingIsPermanentFirstComeFirstServed() public {
        _enable();
        _subscribeRef(bob, 1, alice);
        _subscribeRef(carol, 1, alice);
        _subscribeRef(bob, 1, carol); // second subscription cannot rebind
        assertEq(router.referrerOf(bob), alice);
    }

    function test_NoBindingAfterPlainSubscription() public {
        _enable();
        _subscribe(bob, 1);
        _subscribeRef(bob, 1, alice);
        assertEq(router.referrerOf(bob), address(0));
    }

    function test_IgnoresSelfZeroAndNonInvestorReferrer() public {
        _enable();
        _subscribeRef(bob, 1, bob);
        assertEq(router.referrerOf(bob), address(0));
        _subscribeRef(carol, 1, address(0));
        assertEq(router.referrerOf(carol), address(0));

        address dave = makeAddr("dave");
        _subscribeRef(dave, 1, attacker); // attacker never subscribed
        assertEq(router.referrerOf(dave), address(0));
    }

    function test_SingleTierCannotLoop() public {
        _enable();
        _subscribeRef(bob, 1, alice);
        // alice already subscribed, so bob can never become alice's referrer.
        _subscribeRef(alice, 1, bob);
        assertEq(router.referrerOf(alice), address(0));
    }

    function test_FailedSubscriptionDoesNotBind() public {
        _enable();
        _freeze(attacker);
        usdt.mint(attacker, UNIT_PRICE);
        vm.startPrank(attacker);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.subscribeWithReferrer(PID, 1, UNIT_PRICE, alice); // attacker is frozen
        vm.stopPrank();
        assertFalse(router.hasSubscribed(attacker));
        assertEq(router.referrerOf(attacker), address(0));
    }

    function test_TermsChangeOnlyAffectsNewBindings() public {
        _enable();
        _subscribeRef(bob, 1, alice);
        vm.prank(gov);
        router.setReferralTerms(true, 1_000, 30 days);
        _fund(carol, 1);
        vm.expectEmit(true, true, false, true, address(router));
        emit SubscriptionRouter.ReferralBound(carol, alice, 1_000, uint64(block.timestamp + 30 days));
        vm.prank(carol);
        router.subscribeWithReferrer(PID, 1, UNIT_PRICE, alice);
    }

    function test_RevertWhen_TermsOutOfRangeOrNotGovernance() public {
        vm.startPrank(gov);
        vm.expectRevert(SubscriptionRouter.InvalidReferralTerms.selector);
        router.setReferralTerms(true, 5_001, 365 days);
        vm.expectRevert(SubscriptionRouter.InvalidReferralTerms.selector);
        router.setReferralTerms(true, 2_000, 0);
        vm.expectRevert(SubscriptionRouter.InvalidReferralTerms.selector);
        router.setReferralTerms(true, 2_000, 3_651 days);
        vm.stopPrank();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0))
        );
        vm.prank(operator);
        router.setReferralTerms(true, 2_000, 365 days);
    }

    function test_PausedBlocksReferralSubscribe() public {
        _enable();
        vm.prank(pauser);
        router.pause();
        usdt.mint(bob, UNIT_PRICE);
        vm.startPrank(bob);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.subscribeWithReferrer(PID, 1, UNIT_PRICE, alice);
        vm.stopPrank();
    }
}

contract ReferralRewardsTest is BaseTest {
    ReferralRewards internal rewards;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    bytes32 internal leafA;
    bytes32 internal leafB;
    bytes32 internal leafC;
    bytes32 internal root;

    function setUp() public override {
        super.setUp();
        rewards = new ReferralRewards(IERC20(address(usdt)), gov, operator, pauser);
        _publish(100 * ONE, 40 * ONE, 7 * ONE);
        usdt.mint(feeRecipient, 1_000 * ONE);
        vm.prank(feeRecipient);
        usdt.transfer(address(rewards), 200 * ONE); // platform funds from its fee income
        vm.prank(gov);
        rewards.setClaimsEnabled(true);
    }

    function _leaf(address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, amt))));
    }

    /// Three-leaf tree: root = H(H(A,B), C).
    function _publish(uint256 a, uint256 b, uint256 c) internal {
        leafA = _leaf(alice, a);
        leafB = _leaf(bob, b);
        leafC = _leaf(carol, c);
        root = Hashes.commutativeKeccak256(Hashes.commutativeKeccak256(leafA, leafB), leafC);
        vm.prank(operator);
        rewards.setRoot(root, keccak256("rewards.csv"), a + b + c);
    }

    function _proofA() internal view returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = leafB;
        p[1] = leafC;
    }

    function _proofC() internal view returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = Hashes.commutativeKeccak256(leafA, leafB);
    }

    function test_ClaimPaysAccountOnce() public {
        vm.prank(attacker); // anyone can submit; funds go to alice
        rewards.claim(alice, 100 * ONE, _proofA());
        assertEq(usdt.balanceOf(alice), 100 * ONE);
        assertEq(rewards.claimed(alice), 100 * ONE);
        assertEq(rewards.totalClaimed(), 100 * ONE);
        vm.expectRevert(ReferralRewards.NothingToClaim.selector);
        rewards.claim(alice, 100 * ONE, _proofA());
    }

    function test_NewRootPaysOnlyTheIncrease() public {
        rewards.claim(alice, 100 * ONE, _proofA());
        _publish(130 * ONE, 40 * ONE, 7 * ONE);
        assertEq(rewards.epoch(), 2);
        rewards.claim(alice, 130 * ONE, _proofA());
        assertEq(usdt.balanceOf(alice), 130 * ONE);
    }

    function test_RevertWhen_WrongAmountOrProof() public {
        vm.expectRevert(ReferralRewards.InvalidProof.selector);
        rewards.claim(alice, 101 * ONE, _proofA());
        vm.expectRevert(ReferralRewards.InvalidProof.selector);
        rewards.claim(carol, 7 * ONE, _proofA());
        rewards.claim(carol, 7 * ONE, _proofC());
        assertEq(usdt.balanceOf(carol), 7 * ONE);
    }

    function test_RevertWhen_Underfunded() public {
        vm.prank(gov);
        rewards.withdraw(feeRecipient, 150 * ONE); // only 50 left
        vm.expectRevert();
        rewards.claim(alice, 100 * ONE, _proofA());
        assertEq(rewards.claimed(alice), 0);
    }

    function test_DisabledByDefaultAndSwitchable() public {
        ReferralRewards fresh = new ReferralRewards(IERC20(address(usdt)), gov, operator, pauser);
        assertFalse(fresh.claimsEnabled());
        vm.prank(gov);
        rewards.setClaimsEnabled(false);
        vm.expectRevert(ReferralRewards.ClaimsDisabled.selector);
        rewards.claim(alice, 100 * ONE, _proofA());
    }

    function test_PauseBlocksClaims() public {
        vm.prank(pauser);
        rewards.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        rewards.claim(alice, 100 * ONE, _proofA());
        vm.prank(gov);
        rewards.unpause();
        rewards.claim(alice, 100 * ONE, _proofA());
    }

    function test_RevertWhen_Unauthorized() public {
        vm.startPrank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, rewards.ROOT_SETTER_ROLE()
            )
        );
        rewards.setRoot(keccak256("x"), 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        rewards.withdraw(attacker, 1);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        rewards.setClaimsEnabled(true);
        vm.stopPrank();
        // The root setter (operator) cannot move funds directly.
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0))
        );
        rewards.withdraw(operator, 1);
    }

    function test_RevertWhen_ZeroInputs() public {
        vm.expectRevert(ReferralRewards.ZeroValue.selector);
        new ReferralRewards(IERC20(address(0)), gov, operator, pauser);
        vm.expectRevert(ReferralRewards.ZeroValue.selector);
        new ReferralRewards(IERC20(address(usdt)), address(0), operator, pauser);
        vm.expectRevert(ReferralRewards.ZeroValue.selector);
        new ReferralRewards(IERC20(address(usdt)), gov, address(0), pauser);
        vm.prank(operator);
        vm.expectRevert(ReferralRewards.ZeroValue.selector);
        rewards.setRoot(0, 0, 0);
        vm.startPrank(gov);
        vm.expectRevert(ReferralRewards.ZeroValue.selector);
        rewards.withdraw(address(0), 1);
        vm.expectRevert(ReferralRewards.ZeroValue.selector);
        rewards.withdraw(gov, 0);
        vm.stopPrank();
    }

    /// Vector produced by buildReferralTree in packages/shared (TS and Solidity must agree).
    function test_AcceptsProofBuiltByTypeScript() public {
        address a1 = address(0xA1);
        address c3 = address(0xc3);
        bytes32 tsRoot = 0xe023519c03356afa3717b5d51ce55b291cf747ac34556903f5e2aabca693d4f8;
        assertEq(_leaf(a1, ONE), 0x98518aa156408a5e27f6a43ef829a5b5199d6297982abc99af2b92b847237181);
        vm.prank(operator);
        rewards.setRoot(tsRoot, 0, ONE + ONE / 2 + 7);

        bytes32[] memory p1 = new bytes32[](1);
        p1[0] = 0x04d0811a401267566e2260b3d51ab4859abd2e48a2ffa3334c38425da0ca33bb;
        rewards.claim(a1, ONE, p1);
        bytes32[] memory p3 = new bytes32[](2);
        p3[0] = 0x019e660837aaebf37873c83a20205bc7ada6101139e039a3790c373d68d89796;
        p3[1] = 0x98518aa156408a5e27f6a43ef829a5b5199d6297982abc99af2b92b847237181;
        rewards.claim(c3, 7, p3);
        assertEq(usdt.balanceOf(a1), ONE);
        assertEq(usdt.balanceOf(c3), 7);
    }

    function test_Fuzz_ClaimNeverExceedsCumulative(uint96 a1, uint96 a2) public {
        uint256 first = bound(a1, 1, 100 * ONE);
        uint256 second = bound(a2, first, 200 * ONE);
        usdt.mint(address(rewards), 200 * ONE);
        _publish(first, 1, 1);
        rewards.claim(alice, first, _proofA());
        _publish(second, 1, 1);
        if (second > first) rewards.claim(alice, second, _proofA());
        assertEq(usdt.balanceOf(alice), second);
    }
}
