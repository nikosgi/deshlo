package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/deshlo/annotations-api/internal/auth"
	"github.com/deshlo/annotations-api/internal/store"
)

type contextKey string

const projectContextKey contextKey = "project"
const userContextKey contextKey = "user"

type Server struct {
	store      *store.Store
	logger     *log.Logger
	adminToken string
	oauth      GitHubOAuthConfig
	httpClient *http.Client
}

func New(
	st *store.Store,
	logger *log.Logger,
	adminToken string,
	oauth GitHubOAuthConfig,
) *Server {
	return &Server{
		store:      st,
		logger:     logger,
		adminToken: strings.TrimSpace(adminToken),
		oauth:      oauth,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.Handle("/v1/admin/", s.withAdminAuth(s.adminRoutes()))
	mux.Handle("/v1/auth/", s.authRoutes())
	mux.Handle("GET /v1/me", s.withUserAuth(http.HandlerFunc(s.handleMe)))
	mux.Handle("GET /v1/github/repos", s.withUserAuth(http.HandlerFunc(s.handleListGitHubRepos)))
	mux.Handle("GET /v1/projects", s.withUserAuth(http.HandlerFunc(s.handleListUserProjects)))
	mux.Handle("GET /v1/keys", s.withUserAuth(http.HandlerFunc(s.handleListUserKeys)))
	mux.Handle("POST /v1/keys", s.withUserAuth(http.HandlerFunc(s.handleCreateUserKey)))
	mux.Handle("DELETE /v1/keys/{keyID}", s.withUserAuth(http.HandlerFunc(s.handleDeleteUserKey)))
	mux.Handle("GET /v1/projects/{projectID}/keys", s.withUserAuth(http.HandlerFunc(s.handleListUserProjectKeys)))
	mux.Handle("POST /v1/projects/{projectID}/keys", s.withUserAuth(http.HandlerFunc(s.handleCreateUserProjectKey)))
	mux.Handle("POST /v1/projects/{projectID}/keys/{keyID}/revoke", s.withUserAuth(http.HandlerFunc(s.handleRevokeUserProjectKey)))
	mux.Handle("/v1/", s.withAPIKeyAuth(s.routes()))

	return s.withCORS(mux)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/projects/resolve", s.handleResolveProject)
	mux.HandleFunc("GET /v1/threads", s.handleListThreads)
	mux.HandleFunc("POST /v1/threads", s.handleCreateThread)
	mux.HandleFunc("POST /v1/threads/{threadID}/replies", s.handleReplyThread)
	mux.HandleFunc("POST /v1/threads/{threadID}/resolve", s.handleResolveThread)
	mux.HandleFunc("POST /v1/threads/{threadID}/reopen", s.handleReopenThread)
	mux.HandleFunc("PATCH /v1/threads/{threadID}/anchor", s.handleMoveThreadAnchor)
	mux.HandleFunc("DELETE /v1/threads/{threadID}", s.handleDeleteThread)
	return mux
}

func (s *Server) adminRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/admin/projects", s.handleAdminListProjects)
	mux.HandleFunc("POST /v1/admin/projects", s.handleAdminCreateProject)
	mux.HandleFunc("GET /v1/admin/projects/{projectID}/keys", s.handleAdminListProjectKeys)
	mux.HandleFunc("POST /v1/admin/projects/{projectID}/keys", s.handleAdminCreateProjectKey)
	return mux
}

func (s *Server) authRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/auth/github/start", s.handleAuthGitHubStart)
	mux.HandleFunc("GET /v1/auth/github/callback", s.handleAuthGitHubCallback)
	mux.HandleFunc("POST /v1/auth/logout", s.handleAuthLogout)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleResolveProject(w http.ResponseWriter, r *http.Request) {
	project, ok := projectFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"project": map[string]any{
			"projectId": project.ProjectID,
			"name":      project.Name,
		},
	})
}

func (s *Server) handleListThreads(w http.ResponseWriter, r *http.Request) {
	project, ok := projectFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	pageKey := strings.TrimSpace(r.URL.Query().Get("pageKey"))
	commitSHA := strings.TrimSpace(r.URL.Query().Get("commitSha"))
	if pageKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "pageKey is required"})
		return
	}
	if commitSHA == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "commitSha is required"})
		return
	}

	includeStale := false
	if raw := r.URL.Query().Get("includeStale"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "includeStale must be true or false"})
			return
		}
		includeStale = parsed
	}

	environment := strings.TrimSpace(r.URL.Query().Get("environment"))

	threads, err := s.store.ListThreads(r.Context(), store.ListThreadsInput{
		ProjectID:    project.ProjectID,
		PageKey:      pageKey,
		CommitSHA:    commitSHA,
		IncludeStale: includeStale,
		Environment:  environment,
	})
	if err != nil {
		s.logger.Printf("list threads error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"threads": threads,
	})
}

type createThreadRequest struct {
	PageKey     string          `json:"pageKey"`
	CommitSHA   string          `json:"commitSha"`
	Anchor      json.RawMessage `json:"anchor"`
	Body        string          `json:"body"`
	Author      string          `json:"author"`
	Environment string          `json:"environment"`
}

func (s *Server) handleCreateThread(w http.ResponseWriter, r *http.Request) {
	project, ok := projectFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	var payload createThreadRequest
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": err.Error()})
		return
	}

	if payload.PageKey == "" || payload.CommitSHA == "" || payload.Body == "" || len(payload.Anchor) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "pageKey, commitSha, anchor and body are required"})
		return
	}

	thread, err := s.store.CreateThread(r.Context(), store.CreateThreadInput{
		ProjectID:   project.ProjectID,
		Environment: strings.TrimSpace(payload.Environment),
		PageKey:     strings.TrimSpace(payload.PageKey),
		CommitSHA:   strings.TrimSpace(payload.CommitSHA),
		Anchor:      payload.Anchor,
		Body:        strings.TrimSpace(payload.Body),
		Author:      strings.TrimSpace(payload.Author),
	})
	if err != nil {
		s.logger.Printf("create thread error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": fmt.Sprintf("Thread %s created.", thread.ThreadID),
		"thread":  thread,
	})
}

type replyRequest struct {
	PageKey   string `json:"pageKey"`
	CommitSHA string `json:"commitSha"`
	Body      string `json:"body"`
	Author    string `json:"author"`
}

func (s *Server) handleReplyThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadReplyLike(w, r, "reply")
}

func (s *Server) handleResolveThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadReplyLike(w, r, "resolve")
}

func (s *Server) handleReopenThread(w http.ResponseWriter, r *http.Request) {
	s.handleThreadReplyLike(w, r, "reopen")
}

func (s *Server) handleThreadReplyLike(w http.ResponseWriter, r *http.Request, action string) {
	project, ok := projectFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	threadID := strings.TrimSpace(r.PathValue("threadID"))
	if threadID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "threadID is required"})
		return
	}

	switch action {
	case "reply":
		var payload replyRequest
		if err := decodeJSON(r, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": err.Error()})
			return
		}
		if payload.PageKey == "" || payload.CommitSHA == "" || strings.TrimSpace(payload.Body) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "pageKey, commitSha and body are required"})
			return
		}

		thread, err := s.store.AddReply(r.Context(), store.ReplyInput{
			ProjectID: project.ProjectID,
			ThreadID:  threadID,
			PageKey:   strings.TrimSpace(payload.PageKey),
			CommitSHA: strings.TrimSpace(payload.CommitSHA),
			Body:      strings.TrimSpace(payload.Body),
			Author:    strings.TrimSpace(payload.Author),
		})
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "THREAD_NOT_FOUND"})
				return
			}
			s.logger.Printf("reply thread error: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": fmt.Sprintf("Reply added to %s.", threadID),
			"thread":  thread,
		})
		return

	case "resolve", "reopen":
		status := store.ThreadStatusResolved
		if action == "reopen" {
			status = store.ThreadStatusOpen
		}

		thread, err := s.store.SetThreadStatus(r.Context(), project.ProjectID, threadID, status)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "THREAD_NOT_FOUND"})
				return
			}
			s.logger.Printf("set thread status error: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
			return
		}

		message := "Thread resolved."
		if action == "reopen" {
			message = "Thread reopened."
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": message,
			"thread":  thread,
		})
		return
	}

	writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "Unsupported action"})
}

type moveThreadAnchorRequest struct {
	ThreadID  string          `json:"threadId,omitempty"`
	PageKey   string          `json:"pageKey"`
	CommitSHA string          `json:"commitSha"`
	Anchor    json.RawMessage `json:"anchor"`
}

func (s *Server) handleMoveThreadAnchor(w http.ResponseWriter, r *http.Request) {
	project, ok := projectFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	threadID := strings.TrimSpace(r.PathValue("threadID"))
	if threadID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "threadID is required"})
		return
	}

	var payload moveThreadAnchorRequest
	if err := decodeJSON(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": err.Error()})
		return
	}

	if payload.PageKey == "" || payload.CommitSHA == "" || len(payload.Anchor) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "pageKey, commitSha and anchor are required"})
		return
	}
	if payload.ThreadID != "" && strings.TrimSpace(payload.ThreadID) != threadID {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "threadId mismatch"})
		return
	}

	thread, err := s.store.MoveThreadAnchor(r.Context(), store.MoveThreadAnchorInput{
		ProjectID: project.ProjectID,
		ThreadID:  threadID,
		PageKey:   strings.TrimSpace(payload.PageKey),
		CommitSHA: strings.TrimSpace(payload.CommitSHA),
		Anchor:    payload.Anchor,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "THREAD_NOT_FOUND"})
			return
		}
		s.logger.Printf("move thread anchor error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "Thread anchor updated.",
		"thread":  thread,
	})
}

func (s *Server) handleDeleteThread(w http.ResponseWriter, r *http.Request) {
	project, ok := projectFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
		return
	}

	threadID := strings.TrimSpace(r.PathValue("threadID"))
	pageKey := strings.TrimSpace(r.URL.Query().Get("pageKey"))
	commitSHA := strings.TrimSpace(r.URL.Query().Get("commitSha"))
	if threadID == "" || pageKey == "" || commitSHA == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "message": "threadID, pageKey and commitSha are required"})
		return
	}

	if err := s.store.DeleteThread(r.Context(), store.DeleteThreadInput{
		ProjectID: project.ProjectID,
		ThreadID:  threadID,
		PageKey:   pageKey,
		CommitSHA: commitSHA,
	}); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "message": "THREAD_NOT_FOUND"})
			return
		}
		s.logger.Printf("delete thread error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "Thread deleted.",
	})
}

func (s *Server) withAPIKeyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		apiKey := parseAPIKey(r)
		if apiKey == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}

		project, err := s.store.ResolveProjectByAPIKey(r.Context(), apiKey)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
				return
			}
			s.logger.Printf("api key auth error: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
			return
		}

		ctx := context.WithValue(r.Context(), projectContextKey, project)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) withUserAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		token := parseBearerToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}

		claims, err := auth.ParseUserToken(s.oauth.JWTSecret, token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}

		user, err := s.store.GetUserByID(r.Context(), claims.UserID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
				return
			}
			s.logger.Printf("user auth lookup error: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) withAdminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		if s.adminToken == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}

		adminToken := parseAdminToken(r)
		if adminToken == "" || adminToken != s.adminToken {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "message": "AUTH_REQUIRED"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Deshlo-API-Key, X-Deshlo-Admin-Token")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func parseAPIKey(r *http.Request) string {
	if fromHeader := strings.TrimSpace(r.Header.Get("X-Deshlo-API-Key")); fromHeader != "" {
		return fromHeader
	}
	return ""
}

func parseBearerToken(r *http.Request) string {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}
	return ""
}

func parseAdminToken(r *http.Request) string {
	if fromHeader := strings.TrimSpace(r.Header.Get("X-Deshlo-Admin-Token")); fromHeader != "" {
		return fromHeader
	}

	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}
	return ""
}

func projectFromContext(ctx context.Context) (store.Project, bool) {
	project, ok := ctx.Value(projectContextKey).(store.Project)
	return project, ok
}

func userFromContext(ctx context.Context) (store.User, bool) {
	user, ok := ctx.Value(userContextKey).(store.User)
	return user, ok
}

func decodeJSON(r *http.Request, out any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("invalid JSON payload: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
