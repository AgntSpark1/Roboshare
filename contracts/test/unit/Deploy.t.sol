// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";

contract DeployScriptTest is Test {
    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    function _config() internal returns (Deploy.Config memory c) {
        c = Deploy.Config({
            safe: makeAddr("safe"),
            operator: makeAddr("operator"),
            reviewer: makeAddr("reviewer"),
            pauser: makeAddr("pauser"),
            complianceAgent: makeAddr("agent"),
            feeRecipient: makeAddr("feeRecipient"),
            usdt: address(0)
        });
    }

    function test_DeployHandsAdminToSafe() public {
        Deploy.Config memory c = _config();
        Deploy.Deployed memory d = script.deploy(c, address(script));
        assertTrue(d.usdtIsMock);
        assertEq(d.admin, c.safe);
        assertFalse(d.assets.hasRole(0x00, address(script)));
        assertTrue(d.identity.hasRole(0x00, c.safe));
        assertTrue(d.assets.hasRole(0x00, c.safe));
        assertTrue(d.audit.hasRole(0x00, c.safe));
        assertTrue(d.router.hasRole(0x00, c.safe));
        assertTrue(d.factory.hasRole(0x00, c.safe));
        (address factoryAdmin,,,,) = d.factory.roles();
        assertEq(factoryAdmin, c.safe); // per-project contracts get the Safe as admin too
        assertTrue(d.referralRewards.hasRole(0x00, c.safe));
        assertFalse(d.referralRewards.claimsEnabled());
        assertTrue(d.shareMarket.hasRole(0x00, c.safe));
        assertFalse(d.shareMarket.hasRole(0x00, address(this)));
        assertFalse(d.router.referralsEnabled());
    }

    function test_RevertWhen_MockUsdtOnMainnet() public {
        vm.chainId(56);
        vm.expectRevert();
        script.deploy(_config(), address(script));
    }

    function test_RevertWhen_SafeIsNotAContract() public {
        vm.chainId(97);
        _setEnv();
        vm.expectRevert(abi.encodeWithSelector(Deploy.SafeNotContract.selector, makeAddr("safe")));
        script.run();
    }

    function _setEnv() internal {
        vm.setEnv("SAFE", vm.toString(makeAddr("safe")));
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator")));
        vm.setEnv("REVIEWER", vm.toString(makeAddr("reviewer")));
        vm.setEnv("PAUSER", vm.toString(makeAddr("pauser")));
        vm.setEnv("COMPLIANCE_AGENT", vm.toString(makeAddr("agent")));
        vm.setEnv("FEE_RECIPIENT", vm.toString(makeAddr("feeRecipient")));
    }

    function test_RevertWhen_MainnetNotConfirmed() public {
        vm.chainId(56);
        vm.setEnv("SAFE", vm.toString(makeAddr("safe")));
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator")));
        vm.setEnv("REVIEWER", vm.toString(makeAddr("reviewer")));
        vm.setEnv("PAUSER", vm.toString(makeAddr("pauser")));
        vm.setEnv("COMPLIANCE_AGENT", vm.toString(makeAddr("agent")));
        vm.setEnv("FEE_RECIPIENT", vm.toString(makeAddr("feeRecipient")));
        vm.setEnv("CONFIRM_MAINNET", "no");
        vm.expectRevert(Deploy.MainnetNotConfirmed.selector);
        script.run();
    }
}
