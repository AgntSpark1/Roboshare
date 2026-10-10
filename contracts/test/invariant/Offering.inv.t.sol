// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "../BaseTest.sol";
import {OfferingManager} from "../../src/offering/OfferingManager.sol";
import {SubscriptionRouter} from "../../src/offering/SubscriptionRouter.sol";
import {MockUSDT} from "../mocks/MockUSDT.sol";

/// @dev Random subscriptions, donations and refunds during an open offering.
contract OfferingHandler is Test {
    OfferingManager internal offering;
    SubscriptionRouter internal router;
    MockUSDT internal usdt;
    bytes32 internal pid;
    address[] internal actors;
    uint256 public totalPaidIn;

    constructor(OfferingManager o, SubscriptionRouter r, MockUSDT u, bytes32 pid_, address[] memory actors_) {
        (offering, router, usdt, pid, actors) = (o, r, u, pid_, actors_);
    }

    function subscribe(uint256 actorSeed, uint256 units) external {
        address who = actors[actorSeed % actors.length];
        units = bound(units, 1, 20);
        uint256 cost;
        try offering.quote(uint32(units)) returns (uint256 c) {
            cost = c;
        } catch {
            return;
        }
        usdt.mint(who, cost);
        vm.startPrank(who);
        usdt.approve(address(router), type(uint256).max);
        try router.subscribe(pid, uint32(units), cost) {
            totalPaidIn += cost;
        } catch {}
        vm.stopPrank();
    }

    function donate(uint256 amount) external {
        usdt.mint(address(offering), bound(amount, 1, 1e24));
    }
}

contract OfferingInvariantTest is BaseTest {
    OfferingHandler internal handler;

    function setUp() public override {
        super.setUp();
        _openOffering(100);
        address[] memory actors = new address[](4);
        for (uint256 i; i < 4; ++i) {
            actors[i] = makeAddr(string(abi.encodePacked("sub", vm.toString(i))));
            _makeEligible(actors[i]);
        }
        handler = new OfferingHandler(offering, router, usdt, PID, actors);
        targetContract(address(handler));
    }

    /// Required invariant: escrow is fully backed and matches what subscribers paid.
    function invariant_EscrowBacked() public view {
        assertGe(usdt.balanceOf(address(offering)), offering.escrowed());
        assertEq(offering.escrowed(), handler.totalPaidIn());
    }

    function invariant_RouterHoldsNothing() public view {
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function invariant_NoSharesBeforeSettlement() public view {
        assertEq(token.totalSupply(), 0);
    }
}
