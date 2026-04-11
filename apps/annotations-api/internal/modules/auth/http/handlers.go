package http

import (
	"net/http"

	authapp "github.com/deshlo/annotations-api/internal/modules/auth/application"
	platformhttp "github.com/deshlo/annotations-api/internal/platform/http"
	"github.com/deshlo/annotations-api/internal/platform/middleware"
)

type Handler struct {
	service *authapp.Service
}

func NewHandler(service *authapp.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) HandleAuthGitHubStart(w http.ResponseWriter, r *http.Request) {
	redirectURL, err := h.service.StartAuthorizationURL()
	if err != nil {
		platformhttp.WriteProviderError(w)
		return
	}
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

func (h *Handler) HandleAuthGitHubCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	redirectURL := h.service.CompleteGitHubCallback(r.Context(), state, code)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

func (h *Handler) HandleAuthLogout(w http.ResponseWriter, _ *http.Request) {
	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}
	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "user": user})
}

func RegisterRoutes(mux *http.ServeMux, handler *Handler, requireUser middleware.Middleware) {
	mux.HandleFunc("GET /v1/auth/github/start", handler.HandleAuthGitHubStart)
	mux.HandleFunc("GET /v1/auth/github/callback", handler.HandleAuthGitHubCallback)
	mux.Handle("POST /v1/account/logout", requireUser(http.HandlerFunc(handler.HandleAuthLogout)))
	mux.Handle("GET /v1/account/me", requireUser(http.HandlerFunc(handler.HandleMe)))
}
