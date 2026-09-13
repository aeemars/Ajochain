package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all configuration for the backend service.
type Config struct {
	// Blockchain
	RPCURL          string
	ContractAddress string
	USDCAddress     string
	StartBlock      uint64

	// Release bot (optional)
	RelayerPrivateKey string

	// Server
	Port   string
	DBPath string

	// Frontend static files path
	FrontendPath string
}

// Load reads configuration from environment variables.
// Falls back to sensible defaults where possible.
func Load() (*Config, error) {
	cfg := &Config{
		RPCURL:            getEnv("RPC_URL", "https://sepolia-rollup.arbitrum.io/rpc"),
		ContractAddress:   getEnv("CONTRACT_ADDRESS", ""),
		USDCAddress:       getEnv("USDC_ADDRESS", ""),
		RelayerPrivateKey: getEnv("RELAYER_PRIVATE_KEY", ""),
		Port:              getEnv("PORT", "8080"),
		DBPath:            getEnv("DB_PATH", "./ajochain.db"),
		FrontendPath:      getEnv("FRONTEND_PATH", "../frontend"),
	}

	// Parse start block
	startBlockStr := getEnv("START_BLOCK", "0")
	startBlock, err := strconv.ParseUint(startBlockStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid START_BLOCK: %w", err)
	}
	cfg.StartBlock = startBlock

	// Validate required fields
	if cfg.ContractAddress == "" {
		return nil, fmt.Errorf("CONTRACT_ADDRESS is required — set it to the deployed AjoGroup address")
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
