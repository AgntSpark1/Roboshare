// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {RwaShareToken} from "../../src/token/RwaShareToken.sol";
import {OfferingManager} from "../../src/offering/OfferingManager.sol";
import {SubscriptionRouter} from "../../src/offering/SubscriptionRouter.sol";
import {ProjectState} from "../../src/interfaces/IRoboShare.sol";
import {ProjectFactory} from "../../src/factory/ProjectFactory.sol";
import {MockFeeOnTransferToken, MockReentrantToken} from "../mocks/MockUSDT.sol";

contract RwaShareTokenTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        address[] memory h = new address[](1);
        uint32[] memory u = new uint32[](1);
        h[0] = alice;
        u[0] = 60;
        _fundAndActivate(h, u);
    }

    function test_Metadata() public view {
        assertEq(token.decimals(), 0);
        assertEq(token.CAP(), 100);
        assertEq(token.totalSupply(), 60);
        assertEq(token.balanceOf(alice), 60);
    }

    /// Required test 1: unauthorized minting.
    function test_RevertWhen_NonMinterMints() public {
        vm.prank(gov);
        vm.expectRevert(RwaShareToken.OnlyMinter.selector);
        token.mint(gov, 1);
    }

    function test_RevertWhen_MinterBoundTwice() public {
        vm.prank(address(factory));
        vm.expectRevert(RwaShareToken.MinterAlreadyBound.selector);
        token.bindMinter(attacker);
        vm.prank(attacker);
        vm.expectRevert(RwaShareToken.OnlyMinterBinder.selector);
        token.bindMinter(attacker);
    }

    /// Required test 2: supply above the authorized cap.
    function test_RevertWhen_MintAboveCap() public {
        vm.prank(address(offering));
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.CapExceeded.selector, 41, 40));
        token.mint(alice, 41);
    }

    function test_TransferBetweenEligible() public {
        _makeEligible(bob);
        vm.prank(alice);
        token.transfer(bob, 10);
        assertEq(token.balanceOf(bob), 10);
    }

    /// Required test 4: unauthorized transfers.
    function test_RevertWhen_TransferToIneligible() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.NotEligible.selector, bob));
        token.transfer(bob, 1);
    }

    function test_RevertWhen_TransferFromViaAllowanceToIneligible() public {
        vm.prank(alice);
        token.approve(attacker, 10);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.NotEligible.selector, attacker));
        token.transferFrom(alice, attacker, 10);
    }

    function test_RevertWhen_SenderFrozen() public {
        _makeEligible(bob);
        vm.prank(agent);
        identity.freeze(alice, "SANCTIONS");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.SenderFrozen.selector, alice));
        token.transfer(bob, 1);
    }

    function test_RevertWhen_ClassNotAllowed() public {
        vm.prank(agent);
        identity.setEligibility(bob, 2, 840, uint64(block.timestamp + 1 days), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.ClassNotAllowed.selector, bob, uint16(2)));
        token.transfer(bob, 1);
    }

    /// Required test 5: expired eligibility blocks receiving.
    function test_RevertWhen_ReceiverEligibilityExpired() public {
        _makeEligible(bob);
        vm.warp(block.timestamp + 366 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.NotEligible.selector, bob));
        token.transfer(bob, 1);
    }

    function test_RevertWhen_TransferInSuspendedState() public {
        _makeEligible(bob);
        vm.prank(pauser);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(RwaShareToken.TransfersDisabledInState.selector, ProjectState.SUSPENDED)
        );
        token.transfer(bob, 1);
    }

    function test_RevertWhen_ZeroOrBurn() public {
        _makeEligible(bob);
        vm.startPrank(alice);
        vm.expectRevert(RwaShareToken.ZeroAmount.selector);
        token.transfer(bob, 0);
        vm.expectRevert();
        token.transfer(address(0), 1);
        vm.stopPrank();
    }

    /// Required test 12: paused token.
    function test_PausedTokenBlocksTransfers() public {
        _makeEligible(bob);
        vm.prank(pauser);
        token.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        token.transfer(bob, 1);
        vm.prank(pauser);
        vm.expectRevert();
        token.unpause();
        vm.prank(gov);
        token.unpause();
        vm.prank(alice);
        token.transfer(bob, 1);
    }

    function test_CanTransferExplainsReason() public {
        (bool ok, bytes32 reason) = token.canTransfer(alice, bob, 1);
        assertFalse(ok);
        assertEq(reason, token.REASON_RECEIVER_NOT_ELIGIBLE());
        _makeEligible(bob);
        (ok, reason) = token.canTransfer(alice, bob, 1);
        assertTrue(ok);
    }

    function test_Checkpoints() public {
        uint256 b0 = vm.getBlockNumber(); // cheatcode: block.number is cached across vm.roll under via-IR coverage builds
        _makeEligible(bob);
        vm.prank(alice);
        token.transfer(bob, 20);
        vm.roll(b0 + 5);
        assertEq(token.balanceOfAt(alice, b0 - 1), 60);
        assertEq(token.balanceOfAt(alice, b0), 40);
        assertEq(token.balanceOfAt(bob, b0), 20);
        assertEq(token.totalSupplyAt(b0), 60);
        vm.expectRevert(abi.encodeWithSelector(RwaShareToken.FutureLookup.selector, b0 + 5));
        token.balanceOfAt(alice, b0 + 5);
    }
}

contract OfferingTest is BaseTest {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public override {
        super.setUp();
        _openOffering(50);
        _makeEligible(alice);
        _makeEligible(bob);
    }

    function test_SubscribeThroughRouterWithOneApproval() public {
        usdt.mint(alice, 10 * UNIT_PRICE);
        vm.startPrank(alice);
        usdt.approve(address(router), type(uint256).max); // one-time approval (D-23)
        router.subscribe(PID, 3, 3 * UNIT_PRICE);
        router.subscribe(PID, 2, 2 * UNIT_PRICE); // no second approval
        vm.stopPrank();
        assertEq(offering.unitsOf(alice), 5);
        assertEq(offering.escrowed(), 5 * UNIT_PRICE);
        assertEq(usdt.balanceOf(address(offering)), 5 * UNIT_PRICE);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_RevertWhen_IneligibleSubscribes() public {
        usdt.mint(attacker, UNIT_PRICE);
        vm.startPrank(attacker);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.NotEligible.selector, attacker));
        router.subscribe(PID, 1, UNIT_PRICE);
        vm.stopPrank();
        assertEq(usdt.balanceOf(attacker), UNIT_PRICE); // transfer rolled back
    }

    /// Router security: nobody can spend another wallet's approval.
    function test_RouterOnlyPullsFromCaller() public {
        usdt.mint(alice, 100 * UNIT_PRICE);
        vm.prank(alice);
        usdt.approve(address(router), type(uint256).max);
        // The attacker has no USDT, so the router cannot pull anything on their behalf.
        _makeEligible(attacker);
        vm.prank(attacker);
        vm.expectRevert();
        router.subscribe(PID, 1, UNIT_PRICE);
        assertEq(usdt.balanceOf(alice), 100 * UNIT_PRICE);
    }

    function test_RevertWhen_CostAboveMax() public {
        usdt.mint(alice, UNIT_PRICE);
        vm.startPrank(alice);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionRouter.CostAboveMax.selector, UNIT_PRICE, UNIT_PRICE - 1));
        router.subscribe(PID, 1, UNIT_PRICE - 1);
        vm.stopPrank();
    }

    function test_RevertWhen_UnknownProject() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SubscriptionRouter.OfferingNotLinked.selector, bytes32("nope")));
        router.subscribe(bytes32("nope"), 1, UNIT_PRICE);
    }

    function test_RevertWhen_DirectSubscribeForBypassesRouter() public {
        vm.prank(alice);
        vm.expectRevert(OfferingManager.OnlyRouter.selector);
        offering.subscribeFor(alice, 1, UNIT_PRICE);
    }

    /// Required test 2: subscriptions cannot exceed the authorized allocation.
    function test_RevertWhen_OverAllocation() public {
        _subscribe(alice, 100);
        usdt.mint(bob, UNIT_PRICE);
        vm.startPrank(bob);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.UnitsExceedAvailable.selector, uint32(1), uint32(0)));
        router.subscribe(PID, 1, UNIT_PRICE);
        vm.stopPrank();
    }

    function test_PartialSettlementMintsOnlySoldUnits() public {
        _subscribe(alice, 30);
        _subscribe(bob, 25);
        vm.warp(block.timestamp + 31 days);
        vm.prank(operator);
        offering.settle();
        assertEq(token.totalSupply(), 55);
        assertEq(usdt.balanceOf(treasury), 55 * UNIT_PRICE);
        assertEq(offering.escrowed(), 0);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.FUNDED));
    }

    function test_AnyoneSettlesOnceSoldOut() public {
        _subscribe(alice, 60);
        vm.prank(alice);
        vm.expectRevert(OfferingManager.SettlementConditionsNotMet.selector);
        offering.settle();
        _subscribe(bob, 40);
        vm.prank(bob); // no role, before the deadline
        offering.settle();
        assertEq(token.balanceOf(alice), 60);
        assertEq(token.balanceOf(bob), 40);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.FUNDED));
    }

    function test_RevertWhen_SettleBelowMinimum() public {
        _subscribe(alice, 10);
        vm.warp(block.timestamp + 31 days);
        vm.prank(operator);
        vm.expectRevert(OfferingManager.SettlementConditionsNotMet.selector);
        offering.settle();
    }

    function test_FailedOfferingRefunds() public {
        _subscribe(alice, 10);
        vm.warp(block.timestamp + 31 days);
        offering.finalizeFailed();
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.CANCELLED));
        vm.prank(alice);
        offering.claimRefund();
        assertEq(usdt.balanceOf(alice), 10 * UNIT_PRICE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.NotRefundable.selector, alice));
        offering.claimRefund();
    }

    function test_SettleRevertsOnIneligibleSubscriberUntilExcluded() public {
        _subscribe(alice, 50);
        _subscribe(bob, 30);
        vm.prank(agent);
        identity.revoke(bob, "LAPSED");
        vm.warp(block.timestamp + 31 days);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.SubscriberIneligible.selector, bob));
        offering.settle();

        vm.prank(gov);
        offering.excludeSubscriber(bob, REASON);
        vm.prank(operator);
        offering.settle();
        assertEq(token.totalSupply(), 50);
        vm.prank(bob);
        offering.claimRefund();
        assertEq(usdt.balanceOf(bob), 30 * UNIT_PRICE);
    }

    function test_DonationDoesNotBlockSubscriptions() public {
        usdt.mint(address(offering), 1); // griefing donation
        _subscribe(alice, 1);
        assertEq(offering.escrowed(), UNIT_PRICE);
    }

    /// Required test 12: paused offering and router.
    function test_PausedBlocksSubscribeSettleAndRefund() public {
        _subscribe(alice, 10);
        vm.prank(pauser);
        router.pause();
        usdt.mint(bob, UNIT_PRICE);
        vm.startPrank(bob);
        usdt.approve(address(router), type(uint256).max);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.subscribe(PID, 1, UNIT_PRICE);
        vm.stopPrank();

        vm.prank(gov);
        router.unpause();
        vm.prank(pauser);
        offering.pause();
        vm.warp(block.timestamp + 31 days);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        offering.finalizeFailed();
    }

    /// Required test 11: unauthorized administration.
    function test_RevertWhen_UnauthorizedOfferingAdmin() public {
        vm.startPrank(attacker);
        vm.expectRevert();
        offering.cancel(REASON);
        vm.expectRevert();
        offering.settle();
        vm.expectRevert();
        offering.excludeSubscriber(alice, REASON);
        vm.expectRevert();
        offering.pause();
        vm.stopPrank();
    }

    function test_RevertWhen_ConfigureTwiceOrAfterOpen() public {
        vm.prank(gov);
        vm.expectRevert(OfferingManager.AlreadyOpened.selector);
        offering.configure(_defaultConfig(1));
    }

    function test_PerWalletLimit() public {
        // New project with a per-wallet cap of 10.
        bytes32 pid2 = keccak256("project-2");
        vm.prank(operator);
        assets.registerProject(pid2, keccak256("asset-2"), ISSUER_ID, RIGHTS_HASH);
        vm.prank(reviewer);
        assets.transition(pid2, ProjectState.VERIFIED, REASON);
        vm.startPrank(gov);
        address off2 = factory.deployProject(_params(pid2)).offering;
        OfferingManager.OfferingConfig memory cfg = _defaultConfig(1);
        cfg.perWalletMax = 10;
        OfferingManager(off2).configure(cfg);
        OfferingManager(off2).open();
        vm.stopPrank();

        usdt.mint(alice, 11 * UNIT_PRICE);
        vm.startPrank(alice);
        usdt.approve(address(router), type(uint256).max);
        router.subscribe(pid2, 10, 10 * UNIT_PRICE);
        vm.expectRevert(abi.encodeWithSelector(OfferingManager.PerWalletLimit.selector, uint32(1), uint32(0)));
        router.subscribe(pid2, 1, UNIT_PRICE);
        vm.stopPrank();
    }

    function _params(bytes32 pid) internal view returns (ProjectFactory.ProjectParams memory) {
        return ProjectFactory.ProjectParams({
            projectId: pid, name: "V2", symbol: "RSV2", allowedClassesMask: CLASS_MASK, treasury: treasury
        });
    }
}

/// Required test 14: unexpected token approval or spending behaviour (fee-on-transfer USDT).
contract FeeOnTransferPaymentTest is BaseTest {
    function test_RevertWhen_PaymentTokenTakesFee() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken();
        // A separate router + project wired to the fee-on-transfer token.
        router = new SubscriptionRouter(IERC20(address(fot)), assets, gov, pauser);
        factory = _factoryFor(router);
        vm.startPrank(gov);
        assets.grantRole(assets.FACTORY_ROLE(), address(factory));
        vm.stopPrank();
        _openOffering(1);

        address alice = makeAddr("alice");
        _makeEligible(alice);
        fot.mint(alice, UNIT_PRICE);
        vm.startPrank(alice);
        fot.approve(address(router), type(uint256).max);
        vm.expectRevert(); // received 99% of cost
        router.subscribe(PID, 1, UNIT_PRICE);
        vm.stopPrank();
    }

    function _factoryFor(SubscriptionRouter r) internal returns (ProjectFactory) {
        return new ProjectFactory(
            assets,
            audit,
            identity,
            r,
            factory.tokenDeployer(),
            factory.offeringDeployer(),
            factory.distributorDeployer(),
            ProjectFactory.Roles({
                admin: gov, operator: operator, reviewer: reviewer, pauser: pauser, feeRecipient: feeRecipient
            }),
            gov
        );
    }
}
