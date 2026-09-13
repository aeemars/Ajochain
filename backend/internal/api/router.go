package api

import (
	"net/http"

	"ajochain/backend/internal/relayer"
	"ajochain/backend/internal/store"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"
)

// NewRouter creates the chi router with all API routes and middleware.
func NewRouter(st *store.Store, rel *relayer.Relayer, frontendPath string) http.Handler {
	r := chi.NewRouter()

	// ─── Middleware ─────────────────────────────────────────────────
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Heartbeat("/health"))

	// ─── API Routes ────────────────────────────────────────────────
	h := &Handlers{store: st, relayer: rel}

	r.Route("/api", func(r chi.Router) {
		r.Get("/groups", h.ListGroups)
		r.Get("/groups/{id}", h.GetGroup)
		r.Post("/groups/{id}/check-release", h.CheckRelease)
	})

	// ─── Frontend Static Files ─────────────────────────────────────
	// Serve index.html, app.js, style.css from the frontend directory
	fileServer := http.FileServer(http.Dir(frontendPath))
	r.Handle("/*", fileServer)

	// ─── CORS ──────────────────────────────────────────────────────
	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
	}).Handler(r)

	return handler
}
