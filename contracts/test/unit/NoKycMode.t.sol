// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IdentityRegistry} from "../../src/identity/IdentityRegistry.sol";
import {OfferingManager} from "../../src/offering/OfferingManager.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// Default deployment mode (Charlene, 2026-10-11): no eligibility checks, frozen wallets still blocked.
contract NoKycModeTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        vm.prank(gov);
        identity.setChecksRequired(false);
        _openOffering(10);
    }

    function test_DefaultsOff() public {
        assertFalse(new IdentityRegistry(gov).checksRequired());
    }

    function test_OnlyAdminSwitches() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, bytes32(0))
        );
        identity.setChecksRequired(true);
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

    function test_FrozenWalletsStayBlocked() public {
        vm.prank(agent);
        identity.freeze(alice, "SANCTIONS");
        usdt.mint(alice, UNIT_PRICE);
        vm.startPrank(alice);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.NotEligible.selector, alice));
        router.subscribe(PID, 1, UNIT_PRICE);
        vm.stopPrank();

        _subscribe(bob, 100);
        vm.prank(agent);
        identity.freeze(bob, "SANCTIONS");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.SubscriberIneligible.selector, bob));
        offering.settle();
    }

    function test_FrozenReceiverRejected() public {
        _subscribe(alice, 100);
        vm.prank(operator);
        offering.settle();
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        vm.prank(agent);
        identity.freeze(bob, "SANCTIONS");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.NotEligible.selector, bob));
        token.transfer(bob, 1);
    }
}
