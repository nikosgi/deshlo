package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/deshlo/annotations-api/internal/store"
)

type createUserKeyRequest struct {
	RepoFullName string `json:"repoFullName"`
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"user": user,
	})
}

func (s *Server) handleListUserProjects(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	projects, err := s.store.ListUserProjects(r.Context(), user.UserID)
	if err != nil {
		s.logger.Printf("list user projects error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"projects": projects,
	})
}

func (s *Server) handleListGitHubRepos(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	token, err := s.store.GetUserGitHubAccessToken(r.Context(), user.UserID)
	if err != nil || token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	repos, err := s.fetchGitHubRepos(r.Context(), token)
	if err != nil {
		if errors.Is(err, errGitHubUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}
		s.logger.Printf("list github repos error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"repos": repos,
	})
}

func (s *Server) handleListUserKeys(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	keys, err := s.store.ListUserAPIKeys(r.Context(), user.UserID)
	if err != nil {
		s.logger.Printf("list user keys error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"keys": keys,
	})
}

func (s *Server) handleCreateUserKey(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	var payload createUserKeyRequest
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": err.Error()})
		return
	}

	repoFullName := strings.TrimSpace(payload.RepoFullName)
	if repoFullName == "" || !strings.Contains(repoFullName, "/") {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "repoFullName is required"})
		return
	}

	token, err := s.store.GetUserGitHubAccessToken(r.Context(), user.UserID)
	if err != nil || token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	repo, err := s.fetchGitHubRepoByFullName(r.Context(), token, repoFullName)
	if err != nil {
		if errors.Is(err, errGitHubUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}
		if errors.Is(err, errGitHubNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "REPO_NOT_FOUND"})
			return
		}
		s.logger.Printf("fetch github repo error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	key, project, err := s.store.CreateUserAPIKeyForRepo(r.Context(), store.CreateUserAPIKeyForRepoInput{
		OwnerUserID:  user.UserID,
		Name:         repo.FullName,
		RepoOwner:    repo.Owner.Login,
		RepoName:     repo.Name,
		RepoFullName: repo.FullName,
		RepoHTMLURL:  repo.HTMLURL,
	})
	if err != nil {
		s.logger.Printf("create user project error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"project": project,
		"key":     key,
	})
}

func (s *Server) handleDeleteUserKey(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	keyID := strings.TrimSpace(r.PathValue("keyID"))
	if keyID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "keyID is required"})
		return
	}

	if err := s.store.DeleteUserAPIKey(r.Context(), user.UserID, keyID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "KEY_NOT_FOUND"})
			return
		}
		s.logger.Printf("delete user key error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Key deleted."})
}

func (s *Server) handleListUserProjectKeys(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	projectID := strings.TrimSpace(r.PathValue("projectID"))
	if projectID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "projectID is required"})
		return
	}

	keys, err := s.store.ListUserProjectAPIKeys(r.Context(), user.UserID, projectID)
	if err != nil {
		s.logger.Printf("list user project keys error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "keys": keys})
}

func (s *Server) handleCreateUserProjectKey(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	projectID := strings.TrimSpace(r.PathValue("projectID"))
	if projectID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "projectID is required"})
		return
	}

	key, err := s.store.CreateUserProjectAPIKey(r.Context(), user.UserID, projectID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "PROJECT_NOT_FOUND"})
			return
		}
		s.logger.Printf("create user project key error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "key": key})
}

func (s *Server) handleRevokeUserProjectKey(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	projectID := strings.TrimSpace(r.PathValue("projectID"))
	keyID := strings.TrimSpace(r.PathValue("keyID"))
	if projectID == "" || keyID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "projectID and keyID are required"})
		return
	}

	if err := s.store.RevokeUserProjectAPIKey(r.Context(), user.UserID, projectID, keyID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "KEY_NOT_FOUND"})
			return
		}
		s.logger.Printf("revoke user project key error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Key revoked."})
}
