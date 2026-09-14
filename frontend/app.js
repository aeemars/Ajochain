/* ═══════════════════════════════════════════════════════════════════
   AjoChain — Emil Kowalski Inspired Frontend Logic
   Vanilla JS + ethers.js + Spring Micro-Interactions + Sonner Toasts
   ═══════════════════════════════════════════════════════════════════ */

// ─── Configuration ─────────────────────────────────────────────────
const CONFIG = {
    AJOGROUP_ADDRESS: '0x_YOUR_AJOGROUP_CONTRACT_ADDRESS',
    USDC_ADDRESS: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    USDC_DECIMALS: 6,
    API_BASE: '', // Set to 'http://localhost:8080/api' when Go backend is running

    // Arbitrum Sepolia Chain Parameters (EIP-3085 & EIP-3326 compliant)
    CHAIN_ID: 421614,
    CHAIN_HEX: '0x66eee',
    CHAIN_NAME: 'Arbitrum Sepolia',
    RPC_URL: 'https://sepolia-rollup.arbitrum.io/rpc',
    RPC_URLS: [
        'https://sepolia-rollup.arbitrum.io/rpc',
        'https://arbitrum-sepolia-rpc.publicnode.com',
        'https://arbitrum-sepolia.blockpi.network/v1/rpc/public',
    ],
    EXPLORER_URL: 'https://sepolia.arbiscan.io',
    NATIVE_CURRENCY: {
        name: 'Arbitrum Sepolia Ether',
        symbol: 'ETH',
        decimals: 18,
    },
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

// Sonner-style active toast queue
let activeToasts = [];

// ─── Initialization ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Wire up event listeners
    document.getElementById('connect-btn').addEventListener('click', connectWallet);
    document.getElementById('create-form').addEventListener('submit', handleCreateGroup);

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Initialize Emil sliding tab pill
    updateTabPill();
    window.addEventListener('resize', updateTabPill);

    // Form preset actions
    const btnAddMyAddress = document.getElementById('btn-add-my-address');
    if (btnAddMyAddress) {
        btnAddMyAddress.addEventListener('click', addMyAddressToMembers);
    }

    const btnSetPayoutMine = document.getElementById('btn-set-payout-mine');
    if (btnSetPayoutMine) {
        btnSetPayoutMine.addEventListener('click', setMyAddressAsPayout);
    }

    // Wallet display click-to-copy
    const walletDisplay = document.getElementById('wallet-display');
    if (walletDisplay) {
        walletDisplay.addEventListener('click', () => {
            if (userAddress) copyToClipboard(userAddress, 'Wallet address');
        });
    }

    // Detail payout click-to-copy
    const detailPayout = document.getElementById('detail-payout');
    if (detailPayout) {
        detailPayout.addEventListener('click', () => {
            const addr = detailPayout.dataset.fullAddress;
            if (addr) copyToClipboard(addr, 'Payout address');
        });
    }

    // Attach spotlight effect to static cards
    document.querySelectorAll('.card').forEach(attachSpotlight);

    // Auto-connect if previously connected
    if (window.ethereum && window.ethereum.selectedAddress) {
        connectWallet();
    }

    // Load groups
    loadGroups();
});

// ─── Sliding Segmented Tab Pill (Emil Kowalski Physics) ────────────
function updateTabPill() {
    const activeTab = document.querySelector('.tab.active');
    const pill = document.getElementById('tab-pill');
    if (!activeTab || !pill) return;

    const offsetLeft = activeTab.offsetLeft;
    const width = activeTab.offsetWidth;

    pill.style.transform = `translateX(${offsetLeft - 4}px)`;
    pill.style.width = `${width}px`;
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const targetTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
        updateTabPill();
    }

    // Show/hide views with spring animation
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewId = tabName === 'groups' ? 'groups-view' :
                   tabName === 'create' ? 'create-view' :
                   tabName === 'detail' ? 'detail-view' : null;
    if (viewId) {
        const view = document.getElementById(viewId);
        view.classList.add('active');
    }

    if (tabName === 'groups') {
        loadGroups();
    }
}

// ─── Spotlight Cursor Illumination ─────────────────────────────────
function attachSpotlight(element) {
    if (!element || element.dataset.spotlightAttached) return;
    element.dataset.spotlightAttached = 'true';
    element.classList.add('spotlight-card');

    element.addEventListener('mousemove', (e) => {
        const rect = element.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        element.style.setProperty('--mouse-x', `${x}px`);
        element.style.setProperty('--mouse-y', `${y}px`);
    });
}

// ─── Quick Preset Helpers ──────────────────────────────────────────
function setTargetAmount(amount) {
    const input = document.getElementById('input-target');
    if (input) {
        input.value = amount;
        input.focus();
        showToast(`Target set to ${amount} USDC`, 'info');
    }
}

function setDeadlinePreset(hours) {
    const input = document.getElementById('input-deadline');
    if (!input) return;

    const targetDate = new Date(Date.now() + hours * 3600 * 1000);
    // Format to YYYY-MM-DDTHH:MM
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const hrs = String(targetDate.getHours()).padStart(2, '0');
    const mins = String(targetDate.getMinutes()).padStart(2, '0');

    input.value = `${year}-${month}-${day}T${hrs}:${mins}`;
    showToast(`Deadline set to ${hours} hours from now`, 'info');
}

function addMyAddressToMembers() {
    if (!userAddress) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }
    const textarea = document.getElementById('input-members');
    if (!textarea) return;

    const currentText = textarea.value.trim();
    if (currentText.toLowerCase().includes(userAddress.toLowerCase())) {
        showToast('Your address is already in the members list', 'info');
        return;
    }

    textarea.value = currentText ? `${currentText}\n${userAddress}` : userAddress;
    showToast('Added your wallet to members list', 'success');
}

function setMyAddressAsPayout() {
    if (!userAddress) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }
    const input = document.getElementById('input-payout');
    if (input) {
        input.value = userAddress;
        showToast('Payout address set to your wallet', 'success');
    }
}

// ─── Network Management (EIP-3085 Auto-Integration & EIP-3326) ─────

async function ensureCorrectNetwork() {
    if (!window.ethereum) {
        showToast('MetaMask or Web3 wallet not detected', 'error');
        return false;
    }

    try {
        const currentChainHex = await window.ethereum.request({ method: 'eth_chainId' });
        if (parseInt(currentChainHex, 16) === CONFIG.CHAIN_ID) {
            return true;
        }

        // Step 1: Attempt to switch to Arbitrum Sepolia
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: CONFIG.CHAIN_HEX }],
            });
            return true;
        } catch (switchError) {
            // User rejected prompt
            if (switchError.code === 4001 || switchError?.message?.includes('rejected')) {
                showToast('Please switch your wallet to Arbitrum Sepolia', 'warning', 'Network Required');
                return false;
            }

            // Step 2: If chain is not added yet (code 4902 or unrecognized error)
            const isUnrecognizedChain =
                switchError.code === 4902 ||
                switchError?.data?.originalError?.code === 4902 ||
                switchError.code === -32603 ||
                /unrecognized|not found|unknown chain|could not find|wallet_addEthereumChain/i.test(switchError.message || '');

            if (isUnrecognizedChain) {
                showToast('Adding Arbitrum Sepolia to your wallet...', 'info', 'Network Setup');
                try {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: CONFIG.CHAIN_HEX,
                            chainName: CONFIG.CHAIN_NAME,
                            nativeCurrency: CONFIG.NATIVE_CURRENCY,
                            rpcUrls: CONFIG.RPC_URLS,
                            blockExplorerUrls: [CONFIG.EXPLORER_URL],
                        }],
                    });
                    showToast('Arbitrum Sepolia added & connected! ⬡', 'success', 'Network Added');
                    return true;
                } catch (addError) {
                    if (addError.code === 4001 || addError?.message?.includes('rejected')) {
                        showToast('Network addition was cancelled in your wallet', 'warning');
                    } else {
                        console.error('wallet_addEthereumChain error:', addError);
                        showToast('Failed to add Arbitrum Sepolia: ' + (addError.message || addError), 'error');
                    }
                    return false;
                }
            } else {
                console.error('wallet_switchEthereumChain error:', switchError);
                showToast('Failed to switch network: ' + (switchError.message || switchError), 'error');
                return false;
            }
        }
    } catch (err) {
        console.error('ensureCorrectNetwork error:', err);
        return false;
    }
}

// 1-Click USDC Token Import via EIP-747 (wallet_watchAsset)
async function addUSDCToWallet() {
    if (!window.ethereum) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }
    try {
        await window.ethereum.request({
            method: 'wallet_watchAsset',
            params: {
                type: 'ERC20',
                options: {
                    address: CONFIG.USDC_ADDRESS,
                    symbol: 'USDC',
                    decimals: CONFIG.USDC_DECIMALS,
                },
            },
        });
        showToast('USDC token imported to wallet! 🪙', 'success', 'Token Added');
    } catch (err) {
        if (err.code !== 4001) {
            console.warn('Watch asset skipped:', err);
        }
    }
}

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
        await provider.send('eth_requestAccounts', []);

        // Ensure Arbitrum Sepolia is selected (auto-switches or auto-adds)
        const networkOk = await ensureCorrectNetwork();
        if (!networkOk) {
            btn.textContent = 'Switch Network';
            btn.disabled = false;
            return;
        }

        // Refresh provider to bind to the confirmed network
        provider = new ethers.BrowserProvider(window.ethereum);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        // Initialize contracts
        ajoContract = new ethers.Contract(CONFIG.AJOGROUP_ADDRESS, AJOGROUP_ABI, signer);
        usdcContract = new ethers.Contract(CONFIG.USDC_ADDRESS, ERC20_ABI, signer);

        // Update UI
        const shortAddr = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
        const walletDisplay = document.getElementById('wallet-display');
        walletDisplay.innerHTML = `${shortAddr} <span class="copy-icon">⧉</span>`;
        walletDisplay.style.display = 'inline-flex';
        btn.textContent = 'Connected';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.disabled = false;

        // Show + USDC import button in header
        const btnAddUsdc = document.getElementById('btn-add-usdc');
        if (btnAddUsdc) btnAddUsdc.style.display = 'inline-flex';

        showToast(`Connected: ${shortAddr}`, 'success', 'Wallet Connected');

        // Listen for account/chain changes
        window.ethereum.on('accountsChanged', () => window.location.reload());
        window.ethereum.on('chainChanged', () => window.location.reload());

        // Reload groups with signer
        loadGroups();

    } catch (err) {
        console.error('Wallet connection failed:', err);
        showToast('Wallet connection failed: ' + (err.message || err), 'error');
        const btn = document.getElementById('connect-btn');
        btn.textContent = 'Connect Wallet';
        btn.disabled = false;
    }
}

// ─── Group Data Loading ────────────────────────────────────────────
async function loadGroups() {
    const grid = document.getElementById('groups-grid');
    const emptyState = document.getElementById('empty-state');
    const loadingState = document.getElementById('loading-state');

    grid.innerHTML = '';
    emptyState.style.display = 'none';
    if (loadingState) loadingState.style.display = 'grid';

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

        if (loadingState) loadingState.style.display = 'none';

        if (groups.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        groups.forEach(g => {
            const card = createGroupCard(g);
            grid.appendChild(card);
            attachSpotlight(card);
        });

    } catch (err) {
        console.error('Error loading groups:', err);
        if (loadingState) loadingState.style.display = 'none';
        emptyState.style.display = 'block';
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
    card.className = 'card group-card spotlight-card';
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
            <div class="progress-fill" style="width: ${Math.min(pct, 100)}%"></div>
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

    // Payout Address with click-to-copy
    const payoutAddr = group.payoutAddress;
    const detailPayout = document.getElementById('detail-payout');
    detailPayout.textContent = payoutAddr.slice(0, 8) + '...' + payoutAddr.slice(-6) + ' ⧉';
    detailPayout.dataset.fullAddress = payoutAddr;

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
            <span class="member-address ${isYou ? 'is-you' : ''}" title="Click to copy">
                ${member.slice(0, 8)}...${member.slice(-6)} ${isYou ? '(you)' : ''} ⧉
            </span>
            <span class="member-amount ${hasContributed ? 'contributed' : 'pending'}">
                ${displayAmount} USDC
            </span>
        `;
        row.onclick = () => copyToClipboard(member, 'Member address');
        membersList.appendChild(row);
    });

    // Action buttons
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
        contributeSection.style.display = 'flex';
    }

    if (status === 'funded') {
        releaseBtn.style.display = 'inline-flex';
        releaseBtn.classList.add('btn-release-ready');
    }

    if (status === 'refundable' && isMember) {
        refundBtn.style.display = 'inline-flex';
    }
}

// ─── Create Group Handler ──────────────────────────────────────────
async function handleCreateGroup(e) {
    e.preventDefault();

    if (!signer) {
        showToast('Please connect your wallet first', 'warning');
        return;
    }

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) return;

    const membersRaw = document.getElementById('input-members').value;
    const targetRaw = document.getElementById('input-target').value;
    const deadlineRaw = document.getElementById('input-deadline').value;
    const payoutRaw = document.getElementById('input-payout').value;

    const members = membersRaw
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    if (members.length === 0) {
        showToast('Enter at least one member address', 'error');
        return;
    }

    for (const m of members) {
        if (!ethers.isAddress(m)) {
            showToast(`Invalid member address: ${m}`, 'error');
            return;
        }
    }

    const targetNum = parseFloat(targetRaw);
    if (!targetNum || targetNum <= 0) {
        showToast('Enter a valid target amount (> 0)', 'error');
        return;
    }
    const targetAmount = ethers.parseUnits(targetRaw, CONFIG.USDC_DECIMALS);

    if (!deadlineRaw) {
        showToast('Select a deadline', 'error');
        return;
    }
    const deadlineTimestamp = Math.floor(new Date(deadlineRaw).getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    if (deadlineTimestamp <= now) {
        showToast('Deadline must be in the future', 'error');
        return;
    }

    if (!payoutRaw || !ethers.isAddress(payoutRaw)) {
        showToast('Enter a valid payout address', 'error');
        return;
    }

    const btn = document.getElementById('create-btn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="spinner"></span> Creating Group...';
        btn.disabled = true;

        showToast('Submitting group creation...', 'info', 'Transaction Pending');

        const tx = await ajoContract.createGroup(
            members,
            targetAmount,
            deadlineTimestamp,
            payoutRaw
        );

        showToast('Transaction submitted, waiting for confirmation...', 'info');
        const receipt = await tx.wait();

        showToast('Group created successfully! ⬡', 'success', 'Confirmed');

        // Reset form
        document.getElementById('create-form').reset();

        // Switch to groups view
        switchTab('groups');

    } catch (err) {
        console.error('Create group error:', err);
        showToast('Failed to create group: ' + parseError(err), 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Contribute Handler ────────────────────────────────────────────
async function handleContribute() {
    if (!signer || currentGroupId === null) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) return;

    const input = document.getElementById('input-contribute-amount');
    const amountRaw = input.value;
    const amountNum = parseFloat(amountRaw);

    if (!amountNum || amountNum <= 0) {
        showToast('Enter a valid contribution amount', 'error');
        return;
    }

    const amount = ethers.parseUnits(amountRaw, CONFIG.USDC_DECIMALS);
    const btn = document.getElementById('contribute-btn');
    const originalText = btn.innerHTML;

    try {
        btn.disabled = true;

        // Check allowance
        btn.innerHTML = '<span class="spinner"></span> Checking Allowance...';
        const currentAllowance = await usdcContract.allowance(userAddress, CONFIG.AJOGROUP_ADDRESS);

        if (currentAllowance < amount) {
            btn.innerHTML = '<span class="spinner"></span> Approving USDC...';
            showToast('Approving USDC transfer...', 'info', 'Step 1 of 2');

            const approveTx = await usdcContract.approve(CONFIG.AJOGROUP_ADDRESS, amount);
            await approveTx.wait();
            showToast('USDC approved! Now contributing...', 'success', 'Step 1 Complete');
        }

        // Contribute
        btn.innerHTML = '<span class="spinner"></span> Contributing...';
        showToast('Sending contribution...', 'info', 'Step 2 of 2');

        const contributeTx = await ajoContract.contribute(currentGroupId, amount);
        await contributeTx.wait();

        showToast(`Contributed ${amountRaw} USDC! 💰`, 'success', 'Contribution Confirmed');
        input.value = '';

        // Refresh detail view
        viewGroupDetail(currentGroupId);

    } catch (err) {
        console.error('Contribution error:', err);
        showToast('Contribution failed: ' + parseError(err), 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Release Funds Handler (The Showstopper Demo Moment) ───────────
async function handleRelease() {
    if (!signer || currentGroupId === null) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) return;

    const btn = document.getElementById('release-btn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="spinner"></span> Releasing Funds...';
        btn.disabled = true;

        const tx = await ajoContract.releaseFunds(currentGroupId);
        showToast('Release transaction submitted...', 'info', 'Permissionless Release');

        await tx.wait();

        // Trigger celebratory confetti explosion!
        triggerConfetti();

        showToast('Funds released to payout address! 🔓🎉', 'success', 'Goal Reached!');

        // Refresh view
        viewGroupDetail(currentGroupId);

    } catch (err) {
        console.error('Release error:', err);
        showToast('Release failed: ' + parseError(err), 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Refund Handler ────────────────────────────────────────────────
async function handleRefund() {
    if (!signer || currentGroupId === null) {
        showToast('Connect your wallet first', 'warning');
        return;
    }

    const networkOk = await ensureCorrectNetwork();
    if (!networkOk) return;

    const btn = document.getElementById('refund-btn');
    const originalText = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="spinner"></span> Processing Refund...';
        btn.disabled = true;

        const tx = await ajoContract.refund(currentGroupId);
        showToast('Refund transaction submitted...', 'info');

        await tx.wait();
        showToast('Contribution refunded to your wallet! ↩', 'success', 'Refund Confirmed');

        viewGroupDetail(currentGroupId);

    } catch (err) {
        console.error('Refund error:', err);
        showToast('Refund failed: ' + parseError(err), 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// ─── Sonner-Style Stacked Toast Notifications ──────────────────────
function showToast(message, type = 'info', title = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const id = Date.now() + Math.random().toString(36).substr(2, 5);
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.id = `toast-${id}`;

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ',
        warning: '⚠'
    };

    const defaultTitles = {
        success: 'Success',
        error: 'Error',
        info: 'Notice',
        warning: 'Warning'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ'}</span>
        <div class="toast-content">
            <div class="toast-title">${title || defaultTitles[type]}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="dismissToast('${id}')">✕</button>
    `;

    toast.onclick = (e) => {
        if (!e.target.classList.contains('toast-close')) {
            dismissToast(id);
        }
    };

    container.appendChild(toast);
    activeToasts.unshift({ id, el: toast });
    updateToastStack();

    // Auto-remove after 4.5s
    setTimeout(() => {
        dismissToast(id);
    }, 4500);
}

function dismissToast(id) {
    const idx = activeToasts.findIndex(t => t.id === id);
    if (idx === -1) return;

    const toastItem = activeToasts[idx];
    toastItem.el.classList.add('leaving');

    setTimeout(() => {
        if (toastItem.el.parentNode) {
            toastItem.el.remove();
        }
        activeToasts = activeToasts.filter(t => t.id !== id);
        updateToastStack();
    }, 280);
}

function updateToastStack() {
    activeToasts.forEach((item, index) => {
        item.el.dataset.index = index;
    });
}

// ─── Clipboard Helper ──────────────────────────────────────────────
async function copyToClipboard(text, label = 'Address') {
    try {
        await navigator.clipboard.writeText(text);
        showToast(`${label} copied to clipboard!`, 'info', 'Copied');
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(`${label} copied to clipboard!`, 'info', 'Copied');
    }
}

// ─── 60fps Celebratory Confetti Engine ──────────────────────────────
function triggerConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#9333ea', '#c084fc', '#06b6d4', '#67e8f9', '#10b981', '#34d399', '#ffffff'];
    const particles = [];
    const count = 90;

    for (let i = 0; i < count; i++) {
        particles.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 160,
            y: canvas.height * 0.65,
            vx: (Math.random() - 0.5) * 14,
            vy: -Math.random() * 16 - 6,
            size: Math.random() * 8 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * 360,
            vRot: (Math.random() - 0.5) * 10,
            alpha: 1,
            decay: Math.random() * 0.015 + 0.01
        });
    }

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.45; // gravity
            p.rotation += p.vRot;
            p.alpha -= p.decay;

            if (p.alpha > 0) {
                alive = true;
                ctx.save();
                ctx.globalAlpha = Math.max(0, p.alpha);
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
                ctx.restore();
            }
        });

        if (alive) {
            requestAnimationFrame(render);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
    requestAnimationFrame(render);
}

// ─── Format Helpers ────────────────────────────────────────────────
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

        if (diff < 7 * 24 * 60 * 60 * 1000) {
            const hours = Math.floor(diff / (60 * 60 * 1000));
            if (hours < 1) {
                const mins = Math.floor(diff / (60 * 1000));
                return `${formatted} (${mins}m left)`;
            }
            if (hours < 24) {
                const remainingMins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
                return `${formatted} (${hours}h ${remainingMins}m left)`;
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
    const reason = err?.reason || err?.data?.message || err?.message || 'Unknown error';

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

    if (reason.length > 100) {
        return reason.substring(0, 100) + '...';
    }

    return reason;
}
