package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/deshlo/annotations-api/internal/store"
)

type adminCreateProjectRequest struct {
	Name string `json:"name"`
}

func (s *Server) handleAdminListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.ListProjects(r.Context())
	if err != nil {
		s.logger.Printf("admin list projects error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"projects": projects,
	})
}

func (s *Server) handleAdminCreateProject(w http.ResponseWriter, r *http.Request) {
	var payload adminCreateProjectRequest
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": err.Error()})
		return
	}

	name := strings.TrimSpace(payload.Name)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "name is required"})
		return
	}

	project, err := s.store.CreateProject(r.Context(), name)
	if err != nil {
		s.logger.Printf("admin create project error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"project": project,
	})
}

func (s *Server) handleAdminListProjectKeys(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("projectID"))
	if projectID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "projectID is required"})
		return
	}

	keys, err := s.store.ListProjectAPIKeys(r.Context(), projectID)
	if err != nil {
		s.logger.Printf("admin list api keys error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"keys": keys,
	})
}

func (s *Server) handleAdminCreateProjectKey(w http.ResponseWriter, r *http.Request) {
	projectID := strings.TrimSpace(r.PathValue("projectID"))
	if projectID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "projectID is required"})
		return
	}

	createdKey, err := s.store.CreateProjectAPIKey(r.Context(), projectID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "PROJECT_NOT_FOUND"})
			return
		}

		s.logger.Printf("admin create api key error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":  true,
		"key": createdKey,
	})
}
