// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IdentityRegistry} from "../../src/identity/IdentityRegistry.sol";
import {OfferingManager} from "../../src/offering/OfferingManager.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// No KYC/AML (owner decision, 2026-10-11): any wallet may take part; only frozen wallets are blocked.
contract FreezeOnlyTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        _openOffering(10);
    }

    function test_UnregisteredWalletsSubscribeHoldAndTransfer() public {
        _subscribe(alice, 60);
        _subscribe(bob, 40);
        vm.prank(operator);
        offering.settle();
        assertEq(token.balanceOf(alice), 60);
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        address stranger = makeAddr("stranger");
        (bool ok,) = token.canTransfer(alice, stranger, 5);
        assertTrue(ok);
        vm.prank(alice);
        token.transfer(stranger, 5);
        assertEq(token.balanceOf(stranger), 5);
    }

    function test_FrozenWalletCannotSubscribe() public {
        _freeze(alice);
        usdt.mint(alice, UNIT_PRICE);
        vm.startPrank(alice);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.InvestorFrozen.selector, alice));
        router.subscribe(PID, 1, UNIT_PRICE);
        vm.stopPrank();
    }

    function test_FrozenSubscriberBlocksSettleUntilExcluded() public {
        _subscribe(alice, 50);
        _subscribe(bob, 50);
        _freeze(bob);
        vm.prank(attacker); // settle is permissionless
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.SubscriberFrozen.selector, bob));
        offering.settle();
        vm.prank(gov);
        offering.excludeSubscriber(bob, REASON);
        vm.warp(block.timestamp + 31 days);
        vm.prank(attacker);
        offering.settle();
        assertEq(token.balanceOf(alice), 50);
        assertEq(token.balanceOf(bob), 0);
    }

    function test_FrozenReceiverRejected() public {
        _subscribe(alice, 100);
        vm.prank(operator);
        offering.settle();
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        _freeze(bob);
        (bool ok, bytes32 why) = token.canTransfer(alice, bob, 1);
        assertFalse(ok);
        assertEq(why, token.REASON_RECEIVER_FROZEN());
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.ReceiverFrozen.selector, bob));
        token.transfer(bob, 1);

        // Only governance lifts the freeze; then the transfer goes through.
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, agent, bytes32(0))
        );
        identity.unfreeze(bob);
        vm.prank(gov);
        identity.unfreeze(bob);
        vm.prank(alice);
        token.transfer(bob, 1);
        assertEq(token.balanceOf(bob), 1);
    }

    function test_FreshRegistryFreezesNobody() public {
        IdentityRegistry fresh = new IdentityRegistry(gov);
        assertFalse(fresh.isFrozen(alice));
    }
}
