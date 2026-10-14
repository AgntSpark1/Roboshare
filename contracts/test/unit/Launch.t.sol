// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {BaseTest} from "../BaseTest.sol";
import {ProjectFactory} from "../../src/factory/ProjectFactory.sol";
import {OfferingManager} from "../../src/offering/OfferingManager.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";

/// @notice Automatic listing through ProjectFactory.launch (MATCHMAKER_DESIGN.md).
contract LaunchTest is BaseTest {
    address internal launcher = makeAddr("launcher");
    address internal platform = makeAddr("platformBackstop");

    function setUp() public override {
        super.setUp();
        vm.startPrank(gov);
        factory.grantRole(factory.LAUNCHER_ROLE(), launcher);
        factory.setLaunchTemplate(_template(true));
        vm.stopPrank();
    }

    function _template(bool enabled) internal view returns (ProjectFactory.LaunchTemplate memory) {
        return ProjectFactory.LaunchTemplate({
            enabled: enabled,
            unitPrice: UNIT_PRICE,
            minUnits: 10,
            perWalletMax: 100,
            durationDays: 7,
            termDays: 720,
            minLaunchInterval: 1 hours,
            treasury: treasury,
            termsHash: TERMS_HASH
        });
    }

    function _verified(bytes32 pid, bytes32 assetId, uint32 termDays) internal {
        vm.prank(operator);
        assets.registerProject(pid, assetId, ISSUER_ID, RIGHTS_HASH);
        if (termDays != 0) {
            vm.prank(operator);
            assets.setOperatingTerm(pid, termDays);
        }
        vm.prank(reviewer);
        assets.transition(pid, ProjectState.VERIFIED, REASON);
    }

    function _launch(bytes32 pid) internal returns (ProjectFactory.Deployment memory d) {
        vm.prank(launcher);
        d = factory.launch(pid, "RoboShare Vehicle", "RSV");
    }

    function test_LaunchOpensOfferingOnTemplateTerms() public {
        _verified(PID, ASSET_ID, 720);
        ProjectFactory.Deployment memory d = _launch(PID);
        OfferingManager o = OfferingManager(d.offering);

        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.OFFERING));
        assertTrue(o.opened());
        (uint256 price, uint32 minU, uint32 maxU, uint32 perWallet, uint64 start, uint64 end, address tr, bytes32 th) =
            o.config();
        assertEq(price, UNIT_PRICE);
        assertEq(minU, 10);
        assertEq(maxU, 100);
        assertEq(perWallet, 100);
        assertEq(start, block.timestamp);
        assertEq(end, block.timestamp + 7 days);
        assertEq(tr, treasury);
        assertEq(th, TERMS_HASH);
        assertEq(factory.lastLaunchAt(), block.timestamp);
    }

    function test_GovernanceTakesOverOfferingAdmin() public {
        _verified(PID, ASSET_ID, 720);
        OfferingManager o = OfferingManager(_launch(PID).offering);
        bytes32 adminRole = o.DEFAULT_ADMIN_ROLE();
        assertTrue(o.hasRole(adminRole, gov));
        assertFalse(o.hasRole(adminRole, address(factory)));
        assertFalse(o.hasRole(adminRole, launcher));

        vm.prank(gov);
        o.cancel(REASON);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.CANCELLED));
    }

    function test_UnsetTermMatchesDefaultTemplate() public {
        _verified(PID, ASSET_ID, 0);
        _launch(PID);
        (uint32 termDays,,) = assets.termOf(PID);
        assertEq(termDays, 720);
    }

    function test_TermMustMatchTemplate() public {
        _verified(PID, ASSET_ID, 360);
        vm.prank(launcher);
        vm.expectRevert(abi.encodeWithSelector(ProjectFactory.TermMismatch.selector, uint32(360), uint32(720)));
        factory.launch(PID, "RoboShare Vehicle", "RSV");
    }

    function test_OnlyLauncherOrGovernance() public {
        _verified(PID, ASSET_ID, 720);
        bytes32 role = factory.LAUNCHER_ROLE();
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, role));
        factory.launch(PID, "X", "X");

        vm.prank(gov);
        factory.launch(PID, "RoboShare Vehicle", "RSV");
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.OFFERING));
    }

    function test_OnlyGovernanceSetsTemplate() public {
        vm.prank(launcher);
        vm.expectRevert();
        factory.setLaunchTemplate(_template(true));
    }

    function test_DisabledTemplateBlocksLaunch() public {
        vm.prank(gov);
        factory.setLaunchTemplate(_template(false));
        _verified(PID, ASSET_ID, 720);
        vm.prank(launcher);
        vm.expectRevert(ProjectFactory.LaunchDisabled.selector);
        factory.launch(PID, "RoboShare Vehicle", "RSV");
    }

    function test_InvalidTemplateRejected() public {
        ProjectFactory.LaunchTemplate memory t = _template(true);
        t.treasury = address(0);
        vm.prank(gov);
        vm.expectRevert(ProjectFactory.InvalidTemplate.selector);
        factory.setLaunchTemplate(t);

        t = _template(true);
        t.perWalletMax = 101;
        vm.prank(gov);
        vm.expectRevert(ProjectFactory.InvalidTemplate.selector);
        factory.setLaunchTemplate(t);
    }

    function test_RateLimited() public {
        _verified(PID, ASSET_ID, 720);
        _launch(PID);
        bytes32 pid2 = keccak256("project-2");
        _verified(pid2, keccak256("asset-2"), 720);
        vm.prank(launcher);
        vm.expectRevert(abi.encodeWithSelector(ProjectFactory.LaunchTooSoon.selector, uint64(block.timestamp + 1 hours)));
        factory.launch(pid2, "RoboShare Vehicle 2", "RSV2");

        vm.warp(block.timestamp + 1 hours);
        _launch(pid2);
        assertEq(uint8(assets.stateOf(pid2)), uint8(ProjectState.OFFERING));
    }

    function test_UnverifiedProjectRejected() public {
        vm.prank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.prank(launcher);
        vm.expectRevert(abi.encodeWithSelector(ProjectFactory.ProjectNotVerified.selector, ProjectState.DRAFT));
        factory.launch(PID, "RoboShare Vehicle", "RSV");
    }

    /// @dev The platform fills the rest with its own USDT through the normal router, and the offering settles.
    function test_PlatformBackstopFillsAndSettles() public {
        _verified(PID, ASSET_ID, 720);
        ProjectFactory.Deployment memory d = _launch(PID);
        offering = OfferingManager(d.offering);
        token = RwaShareToken(d.token);

        _subscribe(makeAddr("investor"), 30);
        _subscribe(platform, 70);
        offering.settle();

        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.FUNDED));
        assertEq(token.balanceOf(platform), 70);
        assertEq(usdt.balanceOf(treasury), 100 * UNIT_PRICE);
    }

    function test_ManualDeployStillGovernanceAdmin() public {
        _deployProject();
        assertTrue(offering.hasRole(offering.DEFAULT_ADMIN_ROLE(), gov));
        assertFalse(offering.hasRole(offering.DEFAULT_ADMIN_ROLE(), address(factory)));
    }
}

import {DeployLaunchFactory} from "../../script/DeployLaunchFactory.s.sol";

contract DeployLaunchFactoryTest is BaseTest {
    function test_CopiesWiringAndRoles() public {
        DeployLaunchFactory s = new DeployLaunchFactory();
        ProjectFactory f = s.deploy(factory, gov);
        assertEq(address(f.assetRegistry()), address(assets));
        assertEq(address(f.router()), address(router));
        assertEq(address(f.tokenDeployer()), address(factory.tokenDeployer()));
        assertTrue(f.hasRole(f.DEFAULT_ADMIN_ROLE(), gov));
        assertFalse(f.hasRole(f.DEFAULT_ADMIN_ROLE(), address(s)));
        (, address op,,,) = f.roles();
        assertEq(op, operator);
    }
}
