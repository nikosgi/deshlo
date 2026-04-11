package http

import (
	"errors"
	"net/http"
	"strings"

	accountapp "github.com/deshlo/annotations-api/internal/modules/account/application"
	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
	platformhttp "github.com/deshlo/annotations-api/internal/platform/http"
	"github.com/deshlo/annotations-api/internal/platform/middleware"
)

type Handler struct {
	service *accountapp.Service
}

func NewHandler(service *accountapp.Service) *Handler {
	return &Handler{service: service}
}

type createUserKeyRequest struct {
	RepoFullName string `json:"repoFullName"`
}

func (h *Handler) HandleListGitHubRepos(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	repos, err := h.service.ListGitHubRepos(r.Context(), user.UserID)
	if err != nil {
		if errors.Is(err, accountapp.ErrAuthRequired) || errors.Is(err, githubdomain.ErrUnauthorized) {
			platformhttp.WriteAuthRequired(w)
			return
		}
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "repos": repos})
}

func (h *Handler) HandleListUserProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	projects, err := h.service.ListProjects(r.Context(), user.UserID)
	if err != nil {
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "projects": projects})
}

func (h *Handler) HandleListUserKeys(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	keys, err := h.service.ListKeys(r.Context(), user.UserID)
	if err != nil {
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "keys": keys})
}

func (h *Handler) HandleCreateUserKey(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	var payload createUserKeyRequest
	if err := platformhttp.DecodeJSON(r, &payload); err != nil {
		platformhttp.WriteBadRequest(w, err.Error())
		return
	}

	repoFullName := strings.TrimSpace(payload.RepoFullName)
	if repoFullName == "" || !strings.Contains(repoFullName, "/") {
		platformhttp.WriteBadRequest(w, "repoFullName is required")
		return
	}

	key, project, err := h.service.CreateKeyFromRepository(r.Context(), user.UserID, repoFullName)
	if err != nil {
		if errors.Is(err, accountapp.ErrAuthRequired) {
			platformhttp.WriteAuthRequired(w)
			return
		}
		if errors.Is(err, accountapp.ErrRepoNotFound) {
			platformhttp.WriteNotFound(w, "REPO_NOT_FOUND")
			return
		}
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "project": project, "key": key})
}

func (h *Handler) HandleDeleteUserKey(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	keyID := strings.TrimSpace(r.PathValue("keyID"))
	if keyID == "" {
		platformhttp.WriteBadRequest(w, "keyID is required")
		return
	}

	if err := h.service.DeleteKey(r.Context(), user.UserID, keyID); err != nil {
		if errors.Is(err, accountapp.ErrKeyNotFound) {
			platformhttp.WriteNotFound(w, "KEY_NOT_FOUND")
			return
		}
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Key deleted."})
}

func RegisterRoutes(mux *http.ServeMux, handler *Handler, requireUser middleware.Middleware) {
	mux.Handle("GET /v1/account/repos", requireUser(http.HandlerFunc(handler.HandleListGitHubRepos)))
	mux.Handle("GET /v1/account/projects", requireUser(http.HandlerFunc(handler.HandleListUserProjects)))
	mux.Handle("GET /v1/account/keys", requireUser(http.HandlerFunc(handler.HandleListUserKeys)))
	mux.Handle("POST /v1/account/keys", requireUser(http.HandlerFunc(handler.HandleCreateUserKey)))
	mux.Handle("DELETE /v1/account/keys/{keyID}", requireUser(http.HandlerFunc(handler.HandleDeleteUserKey)))
}
