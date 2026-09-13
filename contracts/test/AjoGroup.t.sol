// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AjoGroup.sol";
import "./mocks/MockUSDC.sol";

/// @title AjoGroup Test Suite
/// @dev   Run with: cd contracts && forge test -vvv
///        Requires: forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
contract AjoGroupTest is Test {
    AjoGroup public ajo;
    MockUSDC public usdc;

    address alice   = makeAddr("alice");
    address bob     = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address payout  = makeAddr("payout");

    function setUp() public {
        usdc = new MockUSDC();
        ajo  = new AjoGroup(address(usdc));

        // Mint 1000 USDC to each test account
        usdc.mint(alice,   1000e6);
        usdc.mint(bob,     1000e6);
        usdc.mint(charlie, 1000e6);

        // Pre-approve AjoGroup to spend their tokens
        vm.prank(alice);
        usdc.approve(address(ajo), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(ajo), type(uint256).max);
        vm.prank(charlie);
        usdc.approve(address(ajo), type(uint256).max);
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    function _createTestGroup() internal returns (uint256) {
        address[] memory members = new address[](3);
        members[0] = alice;
        members[1] = bob;
        members[2] = charlie;
        return ajo.createGroup(members, 300e6, block.timestamp + 1 days, payout);
    }

    // ─── Tests ─────────────────────────────────────────────────────────

    function test_CreateGroup() public {
        uint256 groupId = _createTestGroup();

        (
            address[] memory members,
            uint256 targetAmount,
            uint256 deadline,
            address payoutAddr,
            uint256 totalContributed,
            bool released
        ) = ajo.getGroup(groupId);

        assertEq(members.length, 3);
        assertEq(members[0], alice);
        assertEq(targetAmount, 300e6);
        assertEq(deadline, block.timestamp + 1 days);
        assertEq(payoutAddr, payout);
        assertEq(totalContributed, 0);
        assertFalse(released);
        assertEq(ajo.groupCount(), 1);
    }

    function test_HappyPath_CreateContributeRelease() public {
        uint256 groupId = _createTestGroup();

        // Each member contributes their share
        vm.prank(alice);
        ajo.contribute(groupId, 100e6);

        vm.prank(bob);
        ajo.contribute(groupId, 100e6);

        vm.prank(charlie);
        ajo.contribute(groupId, 100e6);

        // Verify intermediate state
        assertEq(ajo.getContribution(groupId, alice), 100e6);

        // Anyone can trigger the release — this is the permissionless moment
        address randomCaller = makeAddr("random_judge");
        vm.prank(randomCaller);
        ajo.releaseFunds(groupId);

        // Verify final state
        (, , , , , bool released) = ajo.getGroup(groupId);
        assertTrue(released);
        assertEq(usdc.balanceOf(payout), 300e6);
    }

    function test_RefundPath_DeadlinePassedTargetNotMet() public {
        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;
        uint256 groupId = ajo.createGroup(members, 200e6, block.timestamp + 1 days, payout);

        // Alice contributes, Bob doesn't
        vm.prank(alice);
        ajo.contribute(groupId, 80e6);

        // Warp past deadline
        vm.warp(block.timestamp + 2 days);

        // Alice gets her money back
        vm.prank(alice);
        ajo.refund(groupId);

        assertEq(usdc.balanceOf(alice), 1000e6); // Full balance restored
        assertEq(ajo.getContribution(groupId, alice), 0);
    }

    function test_DoubleReleasePrevention() public {
        uint256 groupId = _createTestGroup();

        vm.prank(alice);
        ajo.contribute(groupId, 300e6); // Alice covers the full target

        ajo.releaseFunds(groupId);

        // Second release must revert
        vm.expectRevert("Already released");
        ajo.releaseFunds(groupId);
    }

    function test_NonMemberContributionRejection() public {
        uint256 groupId = _createTestGroup();

        address outsider = makeAddr("outsider");
        usdc.mint(outsider, 1000e6);
        vm.prank(outsider);
        usdc.approve(address(ajo), type(uint256).max);

        vm.prank(outsider);
        vm.expectRevert("Not a member");
        ajo.contribute(groupId, 100e6);
    }

    function test_ContributeAfterDeadline() public {
        uint256 groupId = _createTestGroup();

        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert("Deadline passed");
        ajo.contribute(groupId, 100e6);
    }

    function test_ContributeAfterRelease() public {
        uint256 groupId = _createTestGroup();

        vm.prank(alice);
        ajo.contribute(groupId, 300e6);
        ajo.releaseFunds(groupId);

        vm.prank(bob);
        vm.expectRevert("Already released");
        ajo.contribute(groupId, 100e6);
    }

    function test_RefundBeforeDeadline() public {
        uint256 groupId = _createTestGroup();

        vm.prank(alice);
        ajo.contribute(groupId, 100e6);

        vm.prank(alice);
        vm.expectRevert("Deadline not passed");
        ajo.refund(groupId);
    }

    function test_RefundWhenTargetMet() public {
        uint256 groupId = _createTestGroup();

        vm.prank(alice);
        ajo.contribute(groupId, 300e6);

        vm.warp(block.timestamp + 2 days);

        vm.prank(alice);
        vm.expectRevert("Target met, use releaseFunds");
        ajo.refund(groupId);
    }

    function test_InvalidGroupId() public {
        vm.expectRevert("Group does not exist");
        ajo.getGroup(999);
    }
}
