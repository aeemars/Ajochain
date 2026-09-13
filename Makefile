.PHONY: run backend run-backend run-frontend test-contracts clean

# ─── Quick Start ────────────────────────────────────────────────────

run: run-backend

# ─── Go Backend ─────────────────────────────────────────────────────

backend:
	cd backend && go build -o bin/server ./cmd/server

run-backend:
	cd backend && go run ./cmd/server

test:
	cd backend && go test -v ./...

# ─── Frontend ───────────────────────────────────────────────────────

run-frontend:
	@echo "Serving frontend at http://localhost:3000"
	cd frontend && python3 -m http.server 3000

# ─── Contracts (requires Foundry) ───────────────────────────────────

test-contracts:
	cd contracts && forge test -vvv

# ─── Utilities ──────────────────────────────────────────────────────

clean:
	rm -rf backend/bin backend/*.db backend/*.sqlite
	rm -rf contracts/out contracts/cache
