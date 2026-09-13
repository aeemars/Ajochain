package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"ajochain/backend/internal/relayer"
	"ajochain/backend/internal/store"

	"github.com/go-chi/chi/v5"
)

// Handlers holds dependencies for the HTTP handler functions.
type Handlers struct {
	store   *store.Store
	relayer *relayer.Relayer
}

// ─── GET /api/groups ───────────────────────────────────────────────

// ListGroups returns all groups with their computed status.
func (h *Handlers) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.store.ListGroups()
	if err != nil {
		log.Printf("[api] error listing groups: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to list groups")
		return
	}

	// Return empty array (not null) when no groups exist
	if groups == nil {
		groups = []store.Group{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"groups": groups,
		"count":  len(groups),
	})
}

// ─── GET /api/groups/{id} ──────────────────────────────────────────

// GetGroup returns a single group with its contributions breakdown.
func (h *Handlers) GetGroup(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid group ID")
		return
	}

	detail, err := h.store.GetGroup(id)
	if err != nil {
		log.Printf("[api] error getting group %d: %v", id, err)
		writeError(w, http.StatusInternalServerError, "Failed to get group")
		return
	}

	if detail == nil {
		writeError(w, http.StatusNotFound, "Group not found")
		return
	}

	// Ensure contributions is an empty array, not null
	if detail.Contributions == nil {
		detail.Contributions = []store.Contribution{}
	}

	writeJSON(w, http.StatusOK, detail)
}

// ─── POST /api/groups/{id}/check-release ───────────────────────────

// CheckRelease triggers the convenience release bot for a specific group.
// This is OPTIONAL — the frontend can call releaseFunds directly on-chain.
func (h *Handlers) CheckRelease(w http.ResponseWriter, r *http.Request) {
	if h.relayer == nil {
		writeError(w, http.StatusServiceUnavailable, "Release bot not configured (no RELAYER_PRIVATE_KEY)")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid group ID")
		return
	}

	txHash, err := h.relayer.TryRelease(r.Context(), id)
	if err != nil {
		log.Printf("[api] release check for group %d failed: %v", id, err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"released": true,
		"txHash":   txHash,
		"message":  "Release transaction submitted",
	})
}

// ─── Response Helpers ──────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("[api] error encoding response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
