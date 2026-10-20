// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {ProjectActivator} from "../../src/automation/ProjectActivator.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";

contract ActivatorTest is BaseTest {
    ProjectActivator internal act;
    address internal bot = makeAddr("matchmakerLauncher");

    function setUp() public override {
        super.setUp();
        act = new ProjectActivator(assets, gov);
        vm.startPrank(gov);
        assets.grantRole(assets.DEFAULT_ADMIN_ROLE(), address(act));
        act.grantRole(act.ACTIVATOR_ROLE(), bot);
        vm.stopPrank();
    }

    function _funded() internal {
        _openOffering(100);
        _subscribe(makeAddr("investor"), 100);
        offering.settle();
    }

    function test_ActivatesFundedProject() public {
        _funded();
        vm.prank(bot);
        act.activate(PID);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.ACTIVE));
        (, uint64 startedAt,) = assets.termOf(PID);
        assertEq(startedAt, block.timestamp);
    }

    function test_OnlyFunded() public {
        _openOffering(100);
        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(ProjectActivator.NotFunded.selector, ProjectState.OFFERING));
        act.activate(PID);
    }

    function test_OnlyActivator() public {
        _funded();
        vm.prank(attacker);
        vm.expectRevert();
        act.activate(PID);
    }

    function test_CannotResumeOrSuspend() public {
        _funded();
        vm.prank(bot);
        act.activate(PID);
        vm.prank(gov);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        // a suspended vehicle is not FUNDED: only governance can resume it
        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(ProjectActivator.NotFunded.selector, ProjectState.SUSPENDED));
        act.activate(PID);
    }

    function test_RevokedRoleStops() public {
        _funded();
        vm.prank(gov);
        assets.revokeRole(bytes32(0), address(act));
        vm.prank(bot);
        vm.expectRevert();
        act.activate(PID);
    }
}
