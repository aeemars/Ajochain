/* ═══════════════════════════════════════════════════════════════════
   AjoChain — Frontend Logic
   Vanilla JS + ethers.js for MetaMask + contract interaction
   ═══════════════════════════════════════════════════════════════════ */

// ─── Configuration ─────────────────────────────────────────────────
// Update these after deploying your contracts via Remix
const CONFIG = {
    // Deployed AjoGroup contract address on Arbitrum Sepolia
    AJOGROUP_ADDRESS: '0x_YOUR_AJOGROUP_CONTRACT_ADDRESS',

    // USDC token address on Arbitrum Sepolia
    USDC_ADDRESS: '0x_YOUR_USDC_TOKEN_ADDRESS',

    // USDC decimals (standard USDC = 6)
    USDC_DECIMALS: 6,

    // Go backend API base URL (set to '' to disable API and use direct contract reads)
    API_BASE: '',

    // Arbitrum Sepolia chain ID
    CHAIN_ID: 421614,
    CHAIN_NAME: 'Arbitrum Sepolia',
    RPC_URL: 'https://sepolia-rollup.arbitrum.io/rpc',
    EXPLORER_URL: 'https://sepolia.arbiscan.io',
};

// ─── Contract ABIs ─────────────────────────────────────────────────

const AJOGROUP_ABI = [
    'function createGroup(address[] _members, uint256 _targetAmount, uint256 _deadline, address _payoutAddress) external returns (uint256)',
    'function contribute(uint256 groupId, uint256 amount) external',
    'function releaseFunds(uint256 groupId) external',
    'function refund(uint256 groupId) external',
    'function getGroup(uint256 groupId) external view returns (address[] members, uint256 targetAmount, uint256 deadline, address payoutAddress, uint256 totalContributed, bool released)',
    'function getContribution(uint256 groupId, address member) external view returns (uint256)',
    'function groupCount() external view returns (uint256)',
    'function isMember(uint256 groupId, address member) external view returns (bool)',
    'event GroupCreated(uint256 indexed groupId, address[] members, uint256 targetAmount, uint256 deadline, address payoutAddress)',
    'event Contributed(uint256 indexed groupId, address indexed member, uint256 amount, uint256 totalContributed)',
    'event Released(uint256 indexed groupId, uint256 totalAmount, address payoutAddress)',
    'event Refunded(uint256 indexed groupId, address indexed member, uint256 amount)',
];

const ERC20_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function decimals() external view returns (uint8)',
];

// ─── Global State ──────────────────────────────────────────────────

let provider = null;
let signer = null;
let userAddress = null;
let ajoContract = null;
let usdcContract = null;
let currentGroupId = null;

// ─── Initialization ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Wire up event listeners
    document.getElementById('connect-btn').addEventListener('click', connectWallet);
    document.getElementById('create-form').addEventListener('submit', handleCreateGroup);

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Auto-connect if previously connected
    if (window.ethereum && window.ethereum.selectedAddress) {
        connectWallet();
    }

    // Load groups
    loadGroups();
});

// ─── Wallet Connection ─────────────────────────────────────────────

async function connectWallet() {
    if (!window.ethereum) {
        showToast('MetaMask not detected. Please install MetaMask.', 'error');
        return;
    }

    try {
        const btn = document.getElementById('connect-btn');
        btn.innerHTML = '<span class="spinner"></span> Connecting...';
        btn.disabled = true;

        provider = new ethers.BrowserProvider(window.ethereum);

        // Request account access
        await provider.send('eth_requestAccounts', []);

        // Check network
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== CONFIG.CHAIN_ID) {
            // Try to switch to Arbitrum Sepolia
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x' + CONFIG.CHAIN_ID.toString(16) }],
                });
                provider = new ethers.BrowserProvider(window.ethereum);
            } catch (switchError) {
                // If the chain hasn't been added, add it
                if (switchError.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x' + CONFIG.CHAIN_ID.toString(16),
                            chainName: CONFIG.CHAIN_NAME,
                            rpcUrls: [CONFIG.RPC_URL],
                            blockExplorerUrls: [CONFIG.EXPLORER_URL],
                            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                        }],
                    });
                    provider = new ethers.BrowserProvider(window.ethereum);
                } else {
                    throw switchError;
                }
            }
        }

        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        // Initialize contracts
        ajoContract = new ethers.Contract(CONFIG.AJOGROUP_ADDRESS, AJOGROUP_ABI, signer);
        usdcContract = new ethers.Contract(CONFIG.USDC_ADDRESS, ERC20_ABI, signer);

        // Update UI
        const shortAddr = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
        document.getElementById('wallet-display').textContent = shortAddr;
        document.getElementById('wallet-display').style.display = '';
        btn.textContent = 'Connected';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.disabled = false;

        showToast(`Connected: ${shortAddr}`, 'success');

        // Listen for account/chain changes
        window.ethereum.on('accountsChanged', () => window.location.reload());
        window.ethereum.on('chainChanged', () => window.location.reload());

        // Reload groups now that we have a signer
        loadGroups();

    } catch (err) {
        console.error('Wallet connection failed:', err);
        showToast('Wallet connection failed: ' + (err.message || err), 'error');
        const btn = document.getElementById('connect-btn');
        btn.textContent = 'Connect Wallet';
        btn.disabled = false;
    }
}

// ─── Tab Navigation ────────────────────────────────────────────────

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const targetTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (targetTab) targetTab.classList.add('active');

    // Show/hide views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewId = tabName === 'groups' ? 'groups-view' :
                   tabName === 'create' ? 'create-view' :
                   tabName === 'detail' ? 'detail-view' : null;
    if (viewId) {
        document.getElementById(viewId).classList.add('active');
    }

    // Reload groups when returning to list
    if (tabName === 'groups') {
        loadGroups();
    }
}

// ─── Load Groups ───────────────────────────────────────────────────

async function loadGroups() {
    const grid = document.getElementById('groups-grid');
    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-state');

    grid.innerHTML = '';
    emptyState.style.display = 'none';
    loadingState.style.display = '';

    try {
        let groups = [];

        // Try API first
        if (CONFIG.API_BASE) {
            try {
                const res = await fetch(`${CONFIG.API_BASE}/api/groups`);
                const data = await res.json();
                groups = data.groups || [];
            } catch (apiErr) {
                console.warn('API unavailable, falling back to contract reads:', apiErr);
                groups = await loadGroupsFromContract();
            }
        } else {
            groups = await loadGroupsFromContract();
        }

        loadingState.style.display = 'none';

        if (groups.length === 0) {
            emptyState.style.display = '';
            return;
        }

        groups.forEach(g => {
            grid.appendChild(createGroupCard(g));
        });

    } catch (err) {
        console.error('Error loading groups:', err);
        loadingState.style.display = 'none';
        emptyState.style.display = '';
    }
}

async function loadGroupsFromContract() {
    if (!ajoContract) return [];

    try {
        const count = await ajoContract.groupCount();
        const groups = [];

        for (let i = 0; i < Number(count); i++) {
            const [members, targetAmount, deadline, payoutAddress, totalContributed, released] =
                await ajoContract.getGroup(i);

            groups.push({
                id: i,
                members: members.map(m => m),
                targetAmount: targetAmount.toString(),
                deadline: Number(deadline),
                payoutAddress,
                totalContributed: totalContributed.toString(),
                released,
                status: computeStatus(released, totalContributed, targetAmount, Number(deadline)),
            });
        }

        return groups;
    } catch (err) {
        console.error('Error reading contract:', err);
        return [];
    }
}

function computeStatus(released, totalContributed, targetAmount, deadline) {
    if (released) return 'released';
    const contributed = BigInt(totalContributed.toString());
    const target = BigInt(targetAmount.toString());
    if (contributed >= target && target > 0n) return 'funded';
    if (Date.now() / 1000 > deadline) return 'refundable';
    return 'open';
}

// ─── Group Card Rendering ──────────────────────────────────────────

function createGroupCard(group) {
    const card = document.createElement('div');
    card.className = 'card group-card';
    card.onclick = () => viewGroupDetail(group.id);

    const contributed = formatUSDC(group.totalContributed);
    const target = formatUSDC(group.targetAmount);
    const pct = calcPercent(group.totalContributed, group.targetAmount);
    const deadline = formatDeadline(group.deadline);
    const status = group.status || computeStatus(
        group.released,
        group.totalContributed,
        group.targetAmount,
        group.deadline
    );

    card.innerHTML = `
        <div class="group-card-header">
            <span class="group-card-id">Group #${group.id}</span>
            <span class="status-badge status-${status}">${status}</span>
        </div>
        <div class="group-card-meta">
            <span>👥 ${(group.members || []).length} members</span>
            <span>💰 ${contributed} / ${target} USDC</span>
            <span>⏰ ${deadline}</span>
        </div>
        <div class="progress-bar-mini">
            <div class="progress-fill" style="width: ${pct}%"></div>
        </div>
    `;

    return card;
}

// ─── Group Detail View ─────────────────────────────────────────────

async function viewGroupDetail(groupId) {
    currentGroupId = groupId;
    switchTab('detail');

    try {
        let group, contributions = [];

        // Try API first
        if (CONFIG.API_BASE) {
            try {
                const res = await fetch(`${CONFIG.API_BASE}/api/groups/${groupId}`);
                const data = await res.json();
                group = data.group;
                contributions = data.contributions || [];
            } catch (apiErr) {
                console.warn('API unavailable, using contract reads');
            }
        }

        // Fallback to direct contract reads
        if (!group && ajoContract) {
            const [members, targetAmount, deadline, payoutAddress, totalContributed, released] =
                await ajoContract.getGroup(groupId);

            group = {
                id: groupId,
                members: members.map(m => m),
                targetAmount: targetAmount.toString(),
                deadline: Number(deadline),
                payoutAddress,
                totalContributed: totalContributed.toString(),
                released,
                status: computeStatus(released, totalContributed, targetAmount, Number(deadline)),
            };

            // Get per-member contributions
            for (const member of group.members) {
                const amount = await ajoContract.getContribution(groupId, member);
                contributions.push({
                    member,
                    amount: amount.toString(),
                });
            }
        }

        if (!group) {
            showToast('Could not load group data. Connect your wallet first.', 'error');
            return;
        }

        renderGroupDetail(group, contributions);

    } catch (err) {
        console.error('Error loading group detail:', err);
        showToast('Error loading group: ' + err.message, 'error');
    }
}

function renderGroupDetail(group, contributions) {
    const status = group.status || computeStatus(
        group.released,
        group.totalContributed,
        group.targetAmount,
        group.deadline
    );

    // Header
    document.getElementById('detail-id').textContent = group.id;
    const statusBadge = document.getElementById('detail-status');
    statusBadge.className = `status-badge status-${status}`;
    statusBadge.textContent = status;

    // Progress
    const contributed = formatUSDC(group.totalContributed);
    const target = formatUSDC(group.targetAmount);
    const pct = calcPercent(group.totalContributed, group.targetAmount);

    document.getElementById('detail-contributed').textContent = contributed;
    document.getElementById('detail-target').textContent = target;
    document.getElementById('detail-progress').style.width = `${Math.min(pct, 100)}%`;
    document.getElementById('detail-percent').textContent = `${pct.toFixed(1)}%`;

    // Info
    const payoutAddr = group.payoutAddress;
    document.getElementById('detail-payout').textContent =
        payoutAddr.slice(0, 8) + '...' + payoutAddr.slice(-6);
    document.getElementById('detail-deadline').textContent = formatDeadline(group.deadline);

    // Members
    const membersList = document.getElementById('members-list');
    membersList.innerHTML = '';

    const memberAddresses = group.members || [];
    memberAddresses.forEach(member => {
        const contrib = contributions.find(c =>
            c.member && c.member.toLowerCase() === member.toLowerCase()
        );
        const amount = contrib ? contrib.amount : '0';
        const displayAmount = formatUSDC(amount);
        const isYou = userAddress && member.toLowerCase() === userAddress.toLowerCase();
        const hasContributed = BigInt(amount) > 0n;

        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span class="member-address ${isYou ? 'is-you' : ''}">
                ${member.slice(0, 8)}...${member.slice(-6)} ${isYou ? '(you)' : ''}
            </span>
            <span class="member-amount ${hasContributed ? 'contributed' : 'pending'}">
                ${displayAmount} USDC
            </span>
        `;
        membersList.appendChild(row);
    });

    // Action buttons — show based on status and membership
    const contributeSection = document.getElementById('contribute-section');
    const releaseBtn = document.getElementById('release-btn');
    const refundBtn = document.getElementById('refund-btn');

    contributeSection.style.display = 'none';
    releaseBtn.style.display = 'none';
    refundBtn.style.display = 'none';

    const isMember = userAddress && memberAddresses.some(
        m => m.toLowerCase() === userAddress.toLowerCase()
    );

    if (status === 'open' && isMember) {
        contributeSection.style.display = '';
    }

    if (status === 'funded') {
        releaseBtn.style.display = '';
        releaseBtn.classList.add('btn-release-ready');
    }

    if (status === 'refundable' && isMember) {
        refundBtn.style.display = '';
    }
}

// ─── Create Group ──────────────────────────────────────────────────

async function handleCreateGroup(e) {
    e.preventDefault();

    if (!signer) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const btn = document.getElementById('create-btn');
    const originalText = btn.textContent;

    try {
        // Parse form
        const membersRaw = document.getElementById('input-members').value.trim();
        const members = membersRaw.split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0 && ethers.isAddress(s));

        if (members.length === 0) {
            showToast('Enter at least one valid Ethereum address', 'error');
            return;
        }

        const targetInput = parseFloat(document.getElementById('input-target').value);
        if (!targetInput || targetInput <= 0) {
            showToast('Enter a valid target amount', 'error');
            return;
        }
        const targetAmount = ethers.parseUnits(targetInput.toString(), CONFIG.USDC_DECIMALS);

        const deadlineInput = document.getElementById('input-deadline').value;
        if (!deadlineInput) {
            showToast('Select a deadline', 'error');
            return;
        }
        const deadline = Math.floor(new Date(deadlineInput).getTime() / 1000);
        if (deadline <= Math.floor(Date.now() / 1000)) {
            showToast('Deadline must be in the future', 'error');
            return;
        }

        const payoutAddress = document.getElementById('input-payout').value.trim();
        if (!ethers.isAddress(payoutAddress)) {
            showToast('Enter a valid payout address', 'error');
            return;
        }

        // Send transaction
        btn.innerHTML = '<span class="spinner"></span> Creating...';
        btn.disabled = true;

        const tx = await ajoContract.createGroup(members, targetAmount, deadline, payoutAddress);
        showToast('Transaction submitted. Waiting for confirmation...', 'info');

        const receipt = await tx.wait();
        showToast('Group created successfully! 🎉', 'success');

        // Parse the group ID from the event
        const event = receipt.logs.find(log => {
            try {
                return ajoContract.interface.parseLog(log)?.name === 'GroupCreated';
            } catch { return false; }
        });

        if (event) {
            const parsed = ajoContract.interface.parseLog(event);
            const groupId = Number(parsed.args.groupId);
            showToast(`Group #${groupId} created!`, 'success');

            // Reset form and navigate to detail
            document.getElementById('create-form').reset();
            viewGroupDetail(groupId);
        } else {
            switchTab('groups');
        }

    } catch (err) {
        console.error('Create group error:', err);
        showToast('Create failed: ' + parseError(err), 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// ─── Contribute ────────────────────────────────────────────────────

async function handleContribute() {
    if (!signer || currentGroupId === null) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const btn = document.getElementById('contribute-btn');
    const originalText = btn.textContent;

    try {
        const amountInput = parseFloat(document.getElementById('input-contribute-amount').value);
        if (!amountInput || amountInput <= 0) {
            showToast('Enter a valid amount', 'error');
            return;
        }

        const amount = ethers.parseUnits(amountInput.toString(), CONFIG.USDC_DECIMALS);

        // Step 1: Check allowance and approve if needed
        btn.innerHTML = '<span class="spinner"></span> Checking allowance...';
        btn.disabled = true;

        const currentAllowance = await usdcContract.allowance(userAddress, CONFIG.AJOGROUP_ADDRESS);

        if (currentAllowance < amount) {
            btn.innerHTML = '<span class="spinner"></span> Approving USDC...';
            showToast('Step 1/2: Approving USDC spend...', 'info');

            const approveTx = await usdcContract.approve(CONFIG.AJOGROUP_ADDRESS, amount);
            await approveTx.wait();
            showToast('USDC approved ✓', 'success');
        }

        // Step 2: Contribute
        btn.innerHTML = '<span class="spinner"></span> Contributing...';
        showToast('Step 2/2: Contributing USDC...', 'info');

        const tx = await ajoContract.contribute(currentGroupId, amount);
        await tx.wait();

        showToast(`Contributed ${amountInput} USDC! 🎉`, 'success');
        document.getElementById('input-contribute-amount').value = '';

        // Refresh detail view
        viewGroupDetail(currentGroupId);

    } catch (err) {
        console.error('Contribute error:', err);
        showToast('Contribution failed: ' + parseError(err), 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// ─── Release Funds ─────────────────────────────────────────────────

async function handleRelease() {
    if (!signer || currentGroupId === null) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const btn = document.getElementById('release-btn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="spinner"></span> Releasing...';
        btn.disabled = true;

        const tx = await ajoContract.releaseFunds(currentGroupId);
        showToast('Release transaction submitted...', 'info');

        await tx.wait();
        showToast('Funds released! 🎉🔓', 'success');

        // Refresh
        viewGroupDetail(currentGroupId);

    } catch (err) {
        console.error('Release error:', err);
        showToast('Release failed: ' + parseError(err), 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Refund ────────────────────────────────────────────────────────

async function handleRefund() {
    if (!signer || currentGroupId === null) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const btn = document.getElementById('refund-btn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="spinner"></span> Refunding...';
        btn.disabled = true;

        const tx = await ajoContract.refund(currentGroupId);
        showToast('Refund transaction submitted...', 'info');

        await tx.wait();
        showToast('Refund successful! Your USDC has been returned.', 'success');

        // Refresh
        viewGroupDetail(currentGroupId);

    } catch (err) {
        console.error('Refund error:', err);
        showToast('Refund failed: ' + parseError(err), 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Utility Functions ─────────────────────────────────────────────

function formatUSDC(amountWei) {
    try {
        const val = ethers.formatUnits(amountWei.toString(), CONFIG.USDC_DECIMALS);
        const num = parseFloat(val);
        return num.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    } catch {
        return '0.00';
    }
}

function calcPercent(contributed, target) {
    try {
        const c = BigInt(contributed.toString());
        const t = BigInt(target.toString());
        if (t === 0n) return 0;
        return Number((c * 10000n) / t) / 100;
    } catch {
        return 0;
    }
}

function formatDeadline(unixTimestamp) {
    try {
        const ts = Number(unixTimestamp);
        if (ts === 0) return '—';
        const d = new Date(ts * 1000);
        const now = Date.now();
        const diff = ts * 1000 - now;

        const formatted = d.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

        if (diff < 0) {
            return `${formatted} (expired)`;
        }

        // Show relative time if < 7 days
        if (diff < 7 * 24 * 60 * 60 * 1000) {
            const hours = Math.floor(diff / (60 * 60 * 1000));
            if (hours < 1) {
                const mins = Math.floor(diff / (60 * 1000));
                return `${formatted} (${mins}m left)`;
            }
            if (hours < 24) {
                return `${formatted} (${hours}h left)`;
            }
            const days = Math.floor(hours / 24);
            return `${formatted} (${days}d left)`;
        }

        return formatted;
    } catch {
        return '—';
    }
}

function parseError(err) {
    // Try to extract a clean revert reason
    const reason = err?.reason || err?.data?.message || err?.message || 'Unknown error';

    // Common revert messages from the contract
    const knownErrors = [
        'Not a member', 'Already released', 'Deadline passed',
        'Target not met', 'Deadline not passed', 'Target met, use releaseFunds',
        'Nothing to refund', 'Group does not exist', 'user rejected',
    ];

    for (const known of knownErrors) {
        if (reason.toLowerCase().includes(known.toLowerCase())) {
            return known;
        }
    }

    // Truncate long errors
    if (reason.length > 100) {
        return reason.substring(0, 100) + '...';
    }

    return reason;
}

// ─── Toast System ──────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `<strong>${icons[type] || 'ℹ'}</strong> ${message}`;

    container.appendChild(toast);

    // Auto-remove after 5s
    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}
