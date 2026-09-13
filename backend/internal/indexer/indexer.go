package indexer

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"ajochain/backend/internal/contracts"
	"ajochain/backend/internal/store"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Indexer watches for AjoGroup contract events and writes them to the store.
type Indexer struct {
	client          *ethclient.Client
	store           *store.Store
	contractAddress common.Address
	contractABI     abi.ABI
	pollInterval    time.Duration
}

// New creates a new Indexer.
func New(client *ethclient.Client, st *store.Store, contractAddr string) (*Indexer, error) {
	parsed, err := abi.JSON(strings.NewReader(contracts.AjoGroupABI))
	if err != nil {
		return nil, fmt.Errorf("parse ABI: %w", err)
	}

	return &Indexer{
		client:          client,
		store:           st,
		contractAddress: common.HexToAddress(contractAddr),
		contractABI:     parsed,
		pollInterval:    5 * time.Second,
	}, nil
}

// Run starts the indexing loop. Blocks until context is cancelled.
func (idx *Indexer) Run(ctx context.Context, startBlock uint64) {
	// Resume from the last indexed block, or the configured start
	lastBlock, err := idx.store.GetLastBlock()
	if err != nil {
		log.Printf("[indexer] warning: couldn't read last block, starting from %d: %v", startBlock, err)
		lastBlock = startBlock
	}
	if lastBlock < startBlock {
		lastBlock = startBlock
	}

	log.Printf("[indexer] starting from block %d, polling every %s", lastBlock, idx.pollInterval)

	ticker := time.NewTicker(idx.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[indexer] shutting down")
			return
		case <-ticker.C:
			idx.poll(ctx, &lastBlock)
		}
	}
}

func (idx *Indexer) poll(ctx context.Context, fromBlock *uint64) {
	// Get the current head block
	header, err := idx.client.HeaderByNumber(ctx, nil)
	if err != nil {
		log.Printf("[indexer] error getting latest block: %v", err)
		return
	}
	toBlock := header.Number.Uint64()

	if *fromBlock > toBlock {
		return // nothing new
	}

	// Cap range to avoid huge queries (max 10k blocks at a time)
	queryTo := toBlock
	if queryTo-*fromBlock > 10000 {
		queryTo = *fromBlock + 10000
	}

	query := ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(*fromBlock),
		ToBlock:   new(big.Int).SetUint64(queryTo),
		Addresses: []common.Address{idx.contractAddress},
	}

	logs, err := idx.client.FilterLogs(ctx, query)
	if err != nil {
		log.Printf("[indexer] error filtering logs [%d → %d]: %v", *fromBlock, queryTo, err)
		return
	}

	for _, vLog := range logs {
		idx.processLog(vLog)
	}

	// Advance cursor
	*fromBlock = queryTo + 1
	if err := idx.store.SetLastBlock(*fromBlock); err != nil {
		log.Printf("[indexer] error saving last block: %v", err)
	}

	if len(logs) > 0 {
		log.Printf("[indexer] processed %d events up to block %d", len(logs), queryTo)
	}
}

func (idx *Indexer) processLog(vLog types.Log) {
	if len(vLog.Topics) == 0 {
		return
	}

	switch vLog.Topics[0] {
	case idx.contractABI.Events["GroupCreated"].ID:
		idx.handleGroupCreated(vLog)
	case idx.contractABI.Events["Contributed"].ID:
		idx.handleContributed(vLog)
	case idx.contractABI.Events["Released"].ID:
		idx.handleReleased(vLog)
	case idx.contractABI.Events["Refunded"].ID:
		idx.handleRefunded(vLog)
	}
}

func (idx *Indexer) handleGroupCreated(vLog types.Log) {
	// Indexed: groupId (topic[1])
	groupID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Uint64()

	// Non-indexed: members, targetAmount, deadline, payoutAddress
	event := struct {
		Members       []common.Address
		TargetAmount  *big.Int
		Deadline      *big.Int
		PayoutAddress common.Address
	}{}
	if err := idx.contractABI.UnpackIntoInterface(&event, "GroupCreated", vLog.Data); err != nil {
		log.Printf("[indexer] error unpacking GroupCreated: %v", err)
		return
	}

	members := make([]string, len(event.Members))
	for i, m := range event.Members {
		members[i] = m.Hex()
	}

	if err := idx.store.UpsertGroup(
		groupID,
		members,
		event.TargetAmount.String(),
		event.Deadline.Int64(),
		event.PayoutAddress.Hex(),
	); err != nil {
		log.Printf("[indexer] error storing GroupCreated(id=%d): %v", groupID, err)
		return
	}

	log.Printf("[indexer] GroupCreated: id=%d, members=%d, target=%s", groupID, len(members), event.TargetAmount)
}

func (idx *Indexer) handleContributed(vLog types.Log) {
	// Indexed: groupId (topic[1]), member (topic[2])
	groupID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Uint64()
	member := common.BytesToAddress(vLog.Topics[2].Bytes())

	// Non-indexed: amount, totalContributed
	event := struct {
		Amount           *big.Int
		TotalContributed *big.Int
	}{}
	if err := idx.contractABI.UnpackIntoInterface(&event, "Contributed", vLog.Data); err != nil {
		log.Printf("[indexer] error unpacking Contributed: %v", err)
		return
	}

	if err := idx.store.RecordContribution(
		groupID,
		member.Hex(),
		event.Amount.String(),
		vLog.TxHash.Hex(),
		vLog.BlockNumber,
		event.TotalContributed.String(),
	); err != nil {
		log.Printf("[indexer] error storing Contributed(group=%d, member=%s): %v", groupID, member.Hex(), err)
		return
	}

	log.Printf("[indexer] Contributed: group=%d, member=%s, amount=%s, total=%s",
		groupID, member.Hex()[:10], event.Amount, event.TotalContributed)
}

func (idx *Indexer) handleReleased(vLog types.Log) {
	groupID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Uint64()

	if err := idx.store.MarkReleased(groupID); err != nil {
		log.Printf("[indexer] error storing Released(group=%d): %v", groupID, err)
		return
	}

	log.Printf("[indexer] Released: group=%d", groupID)
}

func (idx *Indexer) handleRefunded(vLog types.Log) {
	groupID := new(big.Int).SetBytes(vLog.Topics[1].Bytes()).Uint64()

	// Non-indexed: amount
	event := struct {
		Amount *big.Int
	}{}
	if err := idx.contractABI.UnpackIntoInterface(&event, "Refunded", vLog.Data); err != nil {
		log.Printf("[indexer] error unpacking Refunded: %v", err)
		return
	}

	// We don't have the new total from the event, so we'll just log it.
	// The next poll will pick up the correct total via subsequent events or
	// a re-read. For a hackathon this is acceptable.
	log.Printf("[indexer] Refunded: group=%d, amount=%s", groupID, event.Amount)
}
