package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"ajochain/backend/internal/store"
)

func TestRouter_Endpoints(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	st, err := store.New(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer st.Close()

	handler := NewRouter(st, nil, dir)

	// 1. Health check
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for /health, got %d", w.Code)
	}

	// 2. GET /api/groups (initially empty)
	req = httptest.NewRequest("GET", "/api/groups", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for /api/groups, got %d", w.Code)
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}
	if resp["count"].(float64) != 0 {
		t.Errorf("expected count 0, got %v", resp["count"])
	}

	// 3. Upsert a group in store and check /api/groups again
	deadline := time.Now().Add(48 * time.Hour).Unix()
	err = st.UpsertGroup(0, []string{"0xUserA", "0xUserB"}, "250000000", deadline, "0xPayout")
	if err != nil {
		t.Fatalf("UpsertGroup failed: %v", err)
	}

	req = httptest.NewRequest("GET", "/api/groups", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for /api/groups, got %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}
	if resp["count"].(float64) != 1 {
		t.Errorf("expected count 1, got %v", resp["count"])
	}

	// 4. GET /api/groups/0
	req = httptest.NewRequest("GET", "/api/groups/0", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for /api/groups/0, got %d", w.Code)
	}

	// 5. GET /api/groups/999 (non-existent)
	req = httptest.NewRequest("GET", "/api/groups/999", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for /api/groups/999, got %d", w.Code)
	}
}
