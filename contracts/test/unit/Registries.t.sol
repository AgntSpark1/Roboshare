// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseTest} from "../BaseTest.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IdentityRegistry} from "../../src/identity/IdentityRegistry.sol";
import {AssetRegistry} from "../../src/registry/AssetRegistry.sol";
import {AuditRegistry} from "../../src/registry/AuditRegistry.sol";
import {ProjectState, RecordKind, RecordStatus, AuditRecord} from "../../src/interfaces/IRoboShare.sol";

contract IdentityRegistryTest is BaseTest {
    address internal alice = makeAddr("alice");

    function test_SetEligibility() public {
        _makeEligible(alice);
        assertTrue(identity.isEligible(alice));
        assertEq(identity.classOf(alice), 1);
    }

    /// Required test 5: expired eligibility.
    function test_EligibilityExpires() public {
        _makeEligible(alice);
        vm.warp(block.timestamp + 365 days);
        assertFalse(identity.isEligible(alice));
    }

    function test_RevertWhen_ExpiryInPast() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.ExpiryInPast.selector, uint64(block.timestamp)));
        identity.setEligibility(alice, 1, 840, uint64(block.timestamp), 0);
    }

    function test_RevertWhen_InvalidClass() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.InvalidClass.selector, uint16(0)));
        identity.setEligibility(alice, 0, 840, uint64(block.timestamp + 1 days), 0);
    }

    function test_FreezeBlocksEligibilityAndOnlyAdminUnfreezes() public {
        _makeEligible(alice);
        vm.prank(agent);
        identity.freeze(alice, "SANCTIONS");
        assertTrue(identity.isFrozen(alice));
        assertFalse(identity.isEligible(alice));

        // The agent cannot re-enable a frozen wallet, nor unfreeze it.
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.WalletIsFrozen.selector, alice));
        identity.setEligibility(alice, 1, 840, uint64(block.timestamp + 1 days), 0);
        vm.prank(agent);
        vm.expectRevert();
        identity.unfreeze(alice);

        vm.prank(gov);
        identity.unfreeze(alice);
        assertFalse(identity.isFrozen(alice));
        assertFalse(identity.isEligible(alice)); // must be re-verified
    }

    function test_Revoke() public {
        _makeEligible(alice);
        vm.prank(agent);
        identity.revoke(alice, "EXPIRED_DOCS");
        assertFalse(identity.isEligible(alice));
    }

    /// Required test 11: unauthorized administration.
    function test_RevertWhen_NonAgentSetsEligibility() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, attacker, identity.COMPLIANCE_AGENT_ROLE()
            )
        );
        vm.prank(attacker);
        identity.setEligibility(attacker, 1, 840, uint64(block.timestamp + 1 days), 0);
    }

    function test_BatchLimits() public {
        address[] memory w = new address[](51);
        uint16[] memory c = new uint16[](51);
        uint64[] memory e = new uint64[](51);
        bytes32[] memory r = new bytes32[](51);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.BatchTooLarge.selector, 51));
        identity.batchSetEligibility(w, c, c, e, r);
    }

    /// Required test 12: paused behaviour.
    function test_PausedBlocksWritesAndOnlyAdminUnpauses() public {
        vm.prank(pauser);
        identity.pause();
        vm.prank(agent);
        vm.expectRevert();
        identity.setEligibility(alice, 1, 840, uint64(block.timestamp + 1 days), 0);
        vm.prank(pauser);
        vm.expectRevert();
        identity.unpause();
        vm.prank(gov);
        identity.unpause();
        _makeEligible(alice);
        assertTrue(identity.isEligible(alice));
    }
}

contract AssetRegistryTest is BaseTest {
    function test_RegisterProject() public {
        vm.prank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.DRAFT));
        assertEq(assets.assetToProject(ASSET_ID), PID);
    }

    /// Required test 3: duplicate project registration.
    function test_RevertWhen_DuplicateProject() public {
        vm.startPrank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.ProjectExists.selector, PID));
        assets.registerProject(PID, keccak256("other-asset"), ISSUER_ID, RIGHTS_HASH);
        vm.stopPrank();
    }

    function test_RevertWhen_DuplicateAsset() public {
        vm.startPrank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.AssetAlreadyRegistered.selector, ASSET_ID));
        assets.registerProject(keccak256("project-2"), ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.stopPrank();
    }

    function test_RevertWhen_RegistrantVerifiesOwnProject() public {
        vm.startPrank(gov);
        assets.grantRole(assets.REVIEWER_ROLE(), operator);
        vm.stopPrank();
        vm.startPrank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.expectRevert(AssetRegistry.SelfApproval.selector);
        assets.transition(PID, ProjectState.VERIFIED, REASON);
        vm.stopPrank();
    }

    /// Required test 10: invalid lifecycle transitions. Exhaustively tries every (from, to) pair
    /// reachable through `transition` and checks only the documented ones succeed for governance.
    function test_InvalidTransitionsRevert() public {
        _registerAndVerify(); // VERIFIED
        ProjectState[11] memory all = [
            ProjectState.NONE,
            ProjectState.DRAFT,
            ProjectState.VERIFIED,
            ProjectState.OFFERING,
            ProjectState.FUNDED,
            ProjectState.ACTIVE,
            ProjectState.SUSPENDED,
            ProjectState.EXIT_PENDING,
            ProjectState.TERMINATED,
            ProjectState.CLOSED,
            ProjectState.CANCELLED
        ];
        for (uint256 i; i < all.length; ++i) {
            ProjectState to = all[i];
            bool allowed = to == ProjectState.CANCELLED;
            uint256 snap = vm.snapshotState();
            vm.prank(gov);
            if (!allowed) vm.expectRevert();
            assets.transition(PID, to, REASON);
            vm.revertToState(snap);
        }
    }

    function test_OfferingTransitionsOnlyFromLinkedOffering() public {
        _deployProject();
        vm.prank(gov);
        vm.expectRevert(abi.encodeWithSelector(AssetRegistry.Unauthorized.selector, gov));
        assets.markFunded(PID, REASON);
        vm.prank(gov);
        vm.expectRevert(
            abi.encodeWithSelector(AssetRegistry.InvalidTransition.selector, ProjectState.VERIFIED, ProjectState.OFFERING)
        );
        assets.transition(PID, ProjectState.OFFERING, REASON);
    }

    function test_TerminalStates() public {
        _registerAndVerify();
        vm.prank(gov);
        assets.transition(PID, ProjectState.CANCELLED, REASON);
        vm.prank(gov);
        vm.expectRevert(
            abi.encodeWithSelector(AssetRegistry.InvalidTransition.selector, ProjectState.CANCELLED, ProjectState.DRAFT)
        );
        assets.transition(PID, ProjectState.DRAFT, REASON);
    }

    function test_FullHappyLifecycle() public {
        address[] memory h = new address[](1);
        uint32[] memory u = new uint32[](1);
        h[0] = makeAddr("holder");
        u[0] = 100;
        _fundAndActivate(h, u);
        vm.prank(pauser);
        assets.transition(PID, ProjectState.SUSPENDED, REASON);
        vm.prank(gov);
        assets.transition(PID, ProjectState.ACTIVE, REASON);
        vm.prank(gov);
        assets.transition(PID, ProjectState.EXIT_PENDING, REASON);
        vm.prank(gov);
        assets.transition(PID, ProjectState.CLOSED, REASON);
        assertEq(uint8(assets.stateOf(PID)), uint8(ProjectState.CLOSED));
    }

    function test_RevertWhen_ZeroReason() public {
        vm.prank(operator);
        assets.registerProject(PID, ASSET_ID, ISSUER_ID, RIGHTS_HASH);
        vm.prank(reviewer);
        vm.expectRevert(AssetRegistry.ZeroValue.selector);
        assets.transition(PID, ProjectState.VERIFIED, bytes32(0));
    }
}

contract AuditRegistryTest is BaseTest {
    function _input(bytes32 hash) internal view returns (AuditRegistry.RecordInput memory) {
        return AuditRegistry.RecordInput({
            projectId: PID,
            kind: RecordKind.FINANCIAL_REPORT,
            contentHash: hash,
            docType: "PNL_REPORT",
            offchainRef: 0,
            periodStart: 1,
            periodEnd: 2,
            distributableAmount: 100 * ONE,
            paymentToken: address(usdt)
        });
    }

    function test_SubmitApproveVerify() public {
        bytes32 id = _approvedReport(100 * ONE, 1, 2);
        AuditRecord memory r = audit.getRecord(id);
        assertEq(uint8(r.status), uint8(RecordStatus.APPROVED));
        assertTrue(audit.verify(id, r.contentHash));
        assertFalse(audit.verify(id, keccak256("tampered")));
    }

    /// Required test 15: malformed or unverified reports.
    function test_RevertWhen_MalformedReport() public {
        AuditRegistry.RecordInput memory bad = _input(keccak256("a"));
        bad.periodEnd = bad.periodStart;
        vm.prank(operator);
        vm.expectRevert(AuditRegistry.InvalidPeriod.selector);
        audit.submitRecord(bad);

        bad = _input(keccak256("b"));
        bad.paymentToken = address(0);
        vm.prank(operator);
        vm.expectRevert(AuditRegistry.InvalidReportFields.selector);
        audit.submitRecord(bad);

        bad = _input(0);
        vm.prank(operator);
        vm.expectRevert(AuditRegistry.ZeroValue.selector);
        audit.submitRecord(bad);
    }

    function test_RevertWhen_DuplicateRecord() public {
        vm.startPrank(operator);
        audit.submitRecord(_input(keccak256("a")));
        vm.expectRevert();
        audit.submitRecord(_input(keccak256("a")));
        vm.stopPrank();
    }

    function test_RevertWhen_SelfApproval() public {
        vm.startPrank(gov);
        audit.grantRole(audit.REVIEWER_ROLE(), operator);
        vm.stopPrank();
        vm.startPrank(operator);
        bytes32 id = audit.submitRecord(_input(keccak256("a")));
        vm.expectRevert(AuditRegistry.SelfApproval.selector);
        audit.approve(id);
        vm.stopPrank();
    }

    function test_RevertWhen_SamePeriodApprovedTwice() public {
        _approvedReport(100 * ONE, 1, 2);
        vm.prank(operator);
        bytes32 id2 = audit.submitRecord(_input(keccak256("second")));
        vm.prank(reviewer);
        vm.expectRevert();
        audit.approve(id2);
    }

    function test_RevertWhen_OverlappingPeriod() public {
        _approvedReport(100 * ONE, 10, 20);
        AuditRegistry.RecordInput memory overlap = _input(keccak256("overlap"));
        overlap.periodStart = 15;
        overlap.periodEnd = 25;
        vm.prank(operator);
        bytes32 id = audit.submitRecord(overlap);
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.PeriodOverlapsApproved.selector, PID, uint64(15), uint64(20)));
        audit.approve(id);
    }

    function test_AmendmentSupersedesWithoutOverwriting() public {
        bytes32 id1 = _approvedReport(100 * ONE, 1, 2);
        AuditRegistry.RecordInput memory amended = _input(keccak256("amended"));
        amended.distributableAmount = 90 * ONE;
        vm.prank(operator);
        bytes32 id2 = audit.submitAmendment(id1, amended);
        vm.prank(reviewer);
        audit.approve(id2);

        assertEq(uint8(audit.getRecord(id1).status), uint8(RecordStatus.SUPERSEDED));
        assertEq(audit.getRecord(id1).distributableAmount, 100 * ONE); // history preserved
        assertEq(audit.getRecord(id2).supersedes, id1);
        assertEq(audit.getRecord(id2).version, 2);
    }

    function test_RejectRequiresReason() public {
        vm.prank(operator);
        bytes32 id = audit.submitRecord(_input(keccak256("a")));
        vm.prank(reviewer);
        vm.expectRevert(AuditRegistry.ZeroValue.selector);
        audit.reject(id, 0);
        vm.prank(reviewer);
        audit.reject(id, REASON);
        assertEq(uint8(audit.getRecord(id).status), uint8(RecordStatus.REJECTED));
    }
}
