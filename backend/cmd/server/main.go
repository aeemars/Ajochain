package main

import (
	"context"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ajochain/backend/internal/api"
	"ajochain/backend/internal/config"
	"ajochain/backend/internal/indexer"
	"ajochain/backend/internal/relayer"
	"ajochain/backend/internal/store"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/joho/godotenv"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)

	// ─── Load config ───────────────────────────────────────────────
	// Load .env if it exists (ignored in production)
	_ = godotenv.Load()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	// ─── Connect to Ethereum ───────────────────────────────────────
	client, err := ethclient.Dial(cfg.RPCURL)
	if err != nil {
		log.Fatalf("connect to RPC %s: %v", cfg.RPCURL, err)
	}
	defer client.Close()

	// Get chain ID for the relayer
	ctx := context.Background()
	chainID, err := client.ChainID(ctx)
	if err != nil {
		log.Printf("warning: couldn't get chain ID, using Arbitrum Sepolia default (421614): %v", err)
		chainID = big.NewInt(421614)
	}
	log.Printf("connected to chain ID %s via %s", chainID, cfg.RPCURL)

	// ─── Initialize store ──────────────────────────────────────────
	st, err := store.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()
	log.Printf("SQLite store initialized at %s", cfg.DBPath)

	// ─── Initialize relayer (optional) ─────────────────────────────
	rel, err := relayer.New(client, cfg.ContractAddress, cfg.RelayerPrivateKey, chainID)
	if err != nil {
		log.Fatalf("relayer: %v", err)
	}
	// rel may be nil if no private key is configured — that's fine

	// ─── Start indexer in background ───────────────────────────────
	indexCtx, indexCancel := context.WithCancel(ctx)
	defer indexCancel()

	idx, err := indexer.New(client, st, cfg.ContractAddress)
	if err != nil {
		log.Fatalf("indexer: %v", err)
	}
	go idx.Run(indexCtx, cfg.StartBlock)

	// ─── Start HTTP server ─────────────────────────────────────────
	router := api.NewRouter(st, rel, cfg.FrontendPath)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		log.Println("shutting down...")
		indexCancel()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		server.Shutdown(shutdownCtx)
	}()

	log.Printf("─────────────────────────────────────────────")
	log.Printf(" AjoChain Backend")
	log.Printf(" API:      http://localhost:%s/api/groups", cfg.Port)
	log.Printf(" Frontend: http://localhost:%s/", cfg.Port)
	log.Printf(" Contract: %s", cfg.ContractAddress)
	log.Printf("─────────────────────────────────────────────")

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}
