# Deploying AjoChain on Arbitrum Sepolia via Remix IDE 🚀

This guide walks you through deploying the `AjoGroup` smart contract to **Arbitrum Sepolia** using [Remix IDE](https://remix.ethereum.org).

---

## 1. Prerequisites

- **MetaMask** installed in your browser.
- MetaMask connected to the **Arbitrum Sepolia** network:
  - **Network Name:** Arbitrum Sepolia
  - **RPC URL:** `https://sepolia-rollup.arbitrum.io/rpc`
  - **Chain ID:** `421614`
  - **Currency Symbol:** `ETH`
  - **Block Explorer:** `https://sepolia.arbiscan.io/`
- Some Arbitrum Sepolia testnet ETH in your wallet for gas (faucet: [QuickNode](https://faucet.quicknode.com/arbitrum/sepolia) or [Alchemy](https://www.alchemy.com/faucets/arbitrum-sepolia)).
- An existing testnet USDC token address on Arbitrum Sepolia.

---

## 2. Load Contract into Remix

1. Open **[Remix IDE](https://remix.ethereum.org)**.
2. In the **File Explorer** (left panel), under the `contracts/` directory, click the **New File** icon and name it `AjoGroup.sol`.
3. Copy the entire contents of [contracts/src/AjoGroup.sol](file:///home/aeem/Downloads/Ajochain/contracts/src/AjoGroup.sol) and paste it into Remix.
   *(Note: Remix will automatically fetch `@openzeppelin/contracts` dependencies).*

---

## 3. Compile the Contract

1. Click on the **Solidity Compiler** tab (left sidebar icon with the Solidity logo "S").
2. Set **Compiler Version** to `0.8.24` (or any `0.8.24+` compatible version).
3. Set **EVM Version** to `default` or `cancun`.
4. Click **Compile AjoGroup.sol**.
5. Ensure a green checkmark appears on the compiler icon.

---

## 4. Deploy to Arbitrum Sepolia

1. Click on the **Deploy & Run Transactions** tab (left sidebar icon with Ethereum logo and arrow).
2. Under **Environment**, select **Injected Provider - MetaMask**.
   - MetaMask will prompt you to connect. Approve the connection.
   - Verify that MetaMask indicates **Arbitrum Sepolia (Chain ID 421614)**.
3. Under **Contract**, ensure **`AjoGroup - contracts/AjoGroup.sol`** is selected.
4. Next to the orange **Deploy** button, expand the constructor argument dropdown:
   - `_usdcToken`: Enter your test USDC token contract address (e.g., `0x...`).
5. Click **transact** (or **Deploy**).
6. Confirm the transaction in MetaMask.
7. Wait for the transaction confirmation on Arbitrum Sepolia.

---

## 5. Copy the Deployed Contract Address

1. Under **Deployed Contracts** at the bottom of the left panel in Remix, expand your newly deployed `AjoGroup` contract.
2. Click the copy icon next to the contract name to copy the deployed contract address (e.g., `0x1234...abcd`).

---

## 6. Update Frontend and Backend Configurations

### A. Frontend (`frontend/app.js`)
Open [frontend/app.js](file:///home/aeem/Downloads/Ajochain/frontend/app.js) and update the `CONFIG` object at the top:

```javascript
const CONFIG = {
    // Paste your newly deployed AjoGroup address:
    AJOGROUP_ADDRESS: '0xYOUR_DEPLOYED_AJOGROUP_ADDRESS',

    // Paste your existing test USDC token address:
    USDC_ADDRESS: '0xYOUR_USDC_TOKEN_ADDRESS',

    // USDC decimals (6 decimals)
    USDC_DECIMALS: 6,

    // Backend API URL (leave '' for direct on-chain mode, or 'http://localhost:8080/api' if backend is running)
    API_BASE: '',

    CHAIN_ID: 421614,
    CHAIN_NAME: 'Arbitrum Sepolia',
    RPC_URL: 'https://sepolia-rollup.arbitrum.io/rpc',
    EXPLORER_URL: 'https://sepolia.arbiscan.io',
};
```

### B. Backend (`backend/.env`)
Copy `backend/.env.example` to `backend/.env`:
```bash
cp backend/.env.example backend/.env
```
Open `backend/.env` and update:
```dotenv
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
CONTRACT_ADDRESS=0xYOUR_DEPLOYED_AJOGROUP_ADDRESS
USDC_ADDRESS=0xYOUR_USDC_TOKEN_ADDRESS
START_BLOCK=<DEPLOYMENT_BLOCK_NUMBER>
PORT=8080
DB_PATH=./ajochain.db
```

---

## 7. Interactive Demo Flow

1. **Start the Frontend**:
   ```bash
   make run-frontend
   ```
   Or open `frontend/index.html` directly in your browser.
2. **Connect Wallet**: Click "Connect Wallet" (MetaMask will connect on Arbitrum Sepolia).
3. **Create a Group**:
   - Provide member wallet addresses (include your wallet).
   - Enter target amount (e.g. 50 USDC).
   - Set deadline (pick a future date/time).
   - Set payout address (e.g., vendor, savings address, or member).
   - Click "Create Group" & confirm on MetaMask.
4. **Contribute**:
   - Step 1: Click "Approve USDC" (grants ERC20 allowance).
   - Step 2: Click "Contribute" (transfers USDC into `AjoGroup`).
5. **Permissionless Release**:
   - Once total contributed reaches target, the glowing green **"Release Funds"** button becomes active.
   - Any wallet can click it — the contract pays out the recipient instantly!
