package relayer

import (
	"context"
	"crypto/ecdsa"
	"fmt"
	"log"
	"math/big"
	"strings"

	"ajochain/backend/internal/contracts"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Relayer is a convenience bot that calls releaseFunds on behalf of users.
// It is ENTIRELY OPTIONAL — the contract is designed to work without it.
// The bot exists purely to create an "auto-release" demo moment for judges.
type Relayer struct {
	client          *ethclient.Client
	contractAddress common.Address
	contractABI     abi.ABI
	privateKey      *ecdsa.PrivateKey
	chainID         *big.Int
}

// New creates a Relayer from a hex private key string.
// Returns nil, nil if privateKeyHex is empty (bot disabled).
func New(client *ethclient.Client, contractAddr, privateKeyHex string, chainID *big.Int) (*Relayer, error) {
	if privateKeyHex == "" {
		log.Println("[relayer] no private key configured — release bot disabled")
		return nil, nil
	}

	// Strip 0x prefix if present
	privateKeyHex = strings.TrimPrefix(privateKeyHex, "0x")

	key, err := crypto.HexToECDSA(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("parse relayer key: %w", err)
	}

	parsed, err := abi.JSON(strings.NewReader(contracts.AjoGroupABI))
	if err != nil {
		return nil, fmt.Errorf("parse ABI: %w", err)
	}

	addr := crypto.PubkeyToAddress(key.PublicKey)
	log.Printf("[relayer] initialized with address %s", addr.Hex())

	return &Relayer{
		client:          client,
		contractAddress: common.HexToAddress(contractAddr),
		contractABI:     parsed,
		privateKey:      key,
		chainID:         chainID,
	}, nil
}

// TryRelease attempts to call releaseFunds(groupId) on the contract.
// Returns the transaction hash on success.
func (r *Relayer) TryRelease(ctx context.Context, groupID uint64) (string, error) {
	// First, check on-chain if the group is actually eligible
	// (could also check the local DB, but on-chain is the source of truth)
	callData, err := r.contractABI.Pack("getGroup", new(big.Int).SetUint64(groupID))
	if err != nil {
		return "", fmt.Errorf("pack getGroup: %w", err)
	}

	result, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &r.contractAddress,
		Data: callData,
	}, nil)
	if err != nil {
		return "", fmt.Errorf("call getGroup: %w", err)
	}

	// Unpack the result
	output, err := r.contractABI.Unpack("getGroup", result)
	if err != nil {
		return "", fmt.Errorf("unpack getGroup: %w", err)
	}

	// output[4] = totalContributed (*big.Int), output[1] = targetAmount (*big.Int), output[5] = released (bool)
	targetAmount := output[1].(*big.Int)
	totalContributed := output[4].(*big.Int)
	released := output[5].(bool)

	if released {
		return "", fmt.Errorf("group %d already released", groupID)
	}
	if totalContributed.Cmp(targetAmount) < 0 {
		return "", fmt.Errorf("group %d target not met: %s / %s", groupID, totalContributed, targetAmount)
	}

	// Build and send the releaseFunds transaction
	txData, err := r.contractABI.Pack("releaseFunds", new(big.Int).SetUint64(groupID))
	if err != nil {
		return "", fmt.Errorf("pack releaseFunds: %w", err)
	}

	fromAddress := crypto.PubkeyToAddress(r.privateKey.PublicKey)

	nonce, err := r.client.PendingNonceAt(ctx, fromAddress)
	if err != nil {
		return "", fmt.Errorf("get nonce: %w", err)
	}

	gasPrice, err := r.client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("get gas price: %w", err)
	}

	// Estimate gas
	gasLimit, err := r.client.EstimateGas(ctx, ethereum.CallMsg{
		From: fromAddress,
		To:   &r.contractAddress,
		Data: txData,
	})
	if err != nil {
		return "", fmt.Errorf("estimate gas: %w", err)
	}

	tx := types.NewTransaction(nonce, r.contractAddress, big.NewInt(0), gasLimit, gasPrice, txData)
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(r.chainID), r.privateKey)
	if err != nil {
		return "", fmt.Errorf("sign tx: %w", err)
	}

	if err := r.client.SendTransaction(ctx, signedTx); err != nil {
		return "", fmt.Errorf("send tx: %w", err)
	}

	log.Printf("[relayer] submitted releaseFunds(group=%d) tx=%s", groupID, signedTx.Hash().Hex())
	return signedTx.Hash().Hex(), nil
}
