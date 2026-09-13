// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AjoGroup — On-chain group contribution and auto-release payments
/// @notice A digital version of the West African "ajo" rotating savings model.
///         Members contribute USDC toward a shared target. Once the target is met,
///         anyone can trigger a permissionless release to the payout address.
/// @dev    Built for the Arbitrum Open House Singapore Buildathon.
///         Deployed on Arbitrum Sepolia testnet.
contract AjoGroup is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Data Structures ───────────────────────────────────────────────

    struct Group {
        address[] members;
        uint256 targetAmount;
        uint256 deadline;        // Unix timestamp
        address payoutAddress;
        uint256 totalContributed;
        bool released;
    }

    // ─── State Variables ───────────────────────────────────────────────

    /// @notice The USDC token contract used for all contributions
    IERC20 public immutable usdcToken;

    /// @notice All groups, keyed by group ID
    mapping(uint256 => Group) private groups;

    /// @notice Per-group, per-member contribution tracking
    mapping(uint256 => mapping(address => uint256)) public contributions;

    /// @notice O(1) membership lookup per group
    mapping(uint256 => mapping(address => bool)) public isMember;

    /// @notice Running counter of total groups created (next group ID)
    uint256 public groupCount;

    // ─── Events ────────────────────────────────────────────────────────

    event GroupCreated(
        uint256 indexed groupId,
        address[] members,
        uint256 targetAmount,
        uint256 deadline,
        address payoutAddress
    );

    event Contributed(
        uint256 indexed groupId,
        address indexed member,
        uint256 amount,
        uint256 totalContributed
    );

    event Released(
        uint256 indexed groupId,
        uint256 totalAmount,
        address payoutAddress
    );

    event Refunded(
        uint256 indexed groupId,
        address indexed member,
        uint256 amount
    );

    // ─── Modifiers ─────────────────────────────────────────────────────

    /// @dev Reverts if groupId does not reference a created group
    modifier validGroup(uint256 groupId) {
        require(groupId < groupCount, "Group does not exist");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────

    /// @param _usdcToken Address of the USDC (or test USDC) token on this chain
    constructor(address _usdcToken) {
        require(_usdcToken != address(0), "Invalid USDC address");
        usdcToken = IERC20(_usdcToken);
    }

    // ─── External Functions ────────────────────────────────────────────

    /// @notice Create a new contribution group
    /// @param _members   Array of member addresses who may contribute
    /// @param _targetAmount Total USDC needed to trigger release (6 decimals)
    /// @param _deadline  Unix timestamp — contributions close after this
    /// @param _payoutAddress Address that receives the pot when target is met
    /// @return groupId   The ID of the newly created group
    /// @dev Duplicate members are not checked on-chain for gas efficiency.
    ///      Keep the member list unique off-chain.
    function createGroup(
        address[] calldata _members,
        uint256 _targetAmount,
        uint256 _deadline,
        address _payoutAddress
    ) external returns (uint256 groupId) {
        require(_members.length > 0, "No members");
        require(_targetAmount > 0, "Target must be > 0");
        require(_deadline > block.timestamp, "Deadline must be in future");
        require(_payoutAddress != address(0), "Invalid payout address");

        groupId = groupCount++;

        Group storage g = groups[groupId];
        g.members = _members;
        g.targetAmount = _targetAmount;
        g.deadline = _deadline;
        g.payoutAddress = _payoutAddress;
        // g.totalContributed and g.released default to 0 / false

        for (uint256 i = 0; i < _members.length; i++) {
            isMember[groupId][_members[i]] = true;
        }

        emit GroupCreated(groupId, _members, _targetAmount, _deadline, _payoutAddress);
    }

    /// @notice Contribute USDC to a group
    /// @dev    Caller must have approved this contract for >= `amount` USDC first.
    /// @param groupId The group to contribute to
    /// @param amount  Amount of USDC to contribute (6 decimals)
    function contribute(uint256 groupId, uint256 amount) external nonReentrant validGroup(groupId) {
        Group storage g = groups[groupId];
        require(isMember[groupId][msg.sender], "Not a member");
        require(!g.released, "Already released");
        require(block.timestamp <= g.deadline, "Deadline passed");
        require(amount > 0, "Amount must be > 0");

        // SECURITY-REVIEW: SafeERC20 handles tokens with non-standard return values
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);

        contributions[groupId][msg.sender] += amount;
        g.totalContributed += amount;

        emit Contributed(groupId, msg.sender, amount, g.totalContributed);
    }

    /// @notice Release the full pot to the payout address
    /// @dev    CALLABLE BY ANYONE — this is the "permissionless release" demo moment.
    ///         Uses nonReentrant guard + checks-effects-interactions (CEI) pattern.
    /// @param groupId The group whose funds to release
    // SECURITY-REVIEW: Verify CEI ordering and nonReentrant guard are correct
    function releaseFunds(uint256 groupId) external nonReentrant validGroup(groupId) {
        Group storage g = groups[groupId];
        require(g.totalContributed >= g.targetAmount, "Target not met");
        require(!g.released, "Already released");

        // ── Effects (before external call) ──
        g.released = true;
        uint256 totalAmount = g.totalContributed;

        emit Released(groupId, totalAmount, g.payoutAddress);

        // ── Interaction (last) ──
        // SECURITY-REVIEW: SafeERC20.safeTransfer handles USDC edge cases
        usdcToken.safeTransfer(g.payoutAddress, totalAmount);
    }

    /// @notice Refund a member's own contribution
    /// @dev    Only available if: deadline has passed AND target was NOT met AND not yet released.
    ///         Uses nonReentrant guard + CEI pattern.
    /// @param groupId The group to request a refund from
    // SECURITY-REVIEW: Verify CEI ordering and nonReentrant guard are correct
    function refund(uint256 groupId) external nonReentrant validGroup(groupId) {
        Group storage g = groups[groupId];
        require(block.timestamp > g.deadline, "Deadline not passed");
        require(!g.released, "Already released");
        require(g.totalContributed < g.targetAmount, "Target met, use releaseFunds");

        uint256 amount = contributions[groupId][msg.sender];
        require(amount > 0, "Nothing to refund");

        // ── Effects (before external call) ──
        contributions[groupId][msg.sender] = 0;
        g.totalContributed -= amount;

        emit Refunded(groupId, msg.sender, amount);

        // ── Interaction (last) ──
        usdcToken.safeTransfer(msg.sender, amount);
    }

    // ─── View Functions ────────────────────────────────────────────────

    /// @notice Read full group details
    /// @dev    Used by the Go indexer and the frontend for on-chain reads
    function getGroup(uint256 groupId)
        external
        view
        validGroup(groupId)
        returns (
            address[] memory members,
            uint256 targetAmount,
            uint256 deadline,
            address payoutAddress,
            uint256 totalContributed,
            bool released
        )
    {
        Group storage g = groups[groupId];
        return (
            g.members,
            g.targetAmount,
            g.deadline,
            g.payoutAddress,
            g.totalContributed,
            g.released
        );
    }

    /// @notice Read a specific member's contribution to a group
    function getContribution(uint256 groupId, address member)
        external
        view
        validGroup(groupId)
        returns (uint256)
    {
        return contributions[groupId][member];
    }
}
