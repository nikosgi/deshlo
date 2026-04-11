package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	annotationsapp "github.com/deshlo/annotations-api/internal/modules/annotations/application"
	annotationsdomain "github.com/deshlo/annotations-api/internal/modules/annotations/domain"
	platformhttp "github.com/deshlo/annotations-api/internal/platform/http"
	"github.com/deshlo/annotations-api/internal/platform/middleware"
)

type Handler struct {
	service *annotationsapp.Service
}

func NewHandler(service *annotationsapp.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) HandleResolveProject(w http.ResponseWriter, r *http.Request) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"project": map[string]any{
			"projectId": project.ProjectID,
			"name":      project.Name,
		},
	})
}

func (h *Handler) HandleListThreads(w http.ResponseWriter, r *http.Request) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	pageKey := strings.TrimSpace(r.URL.Query().Get("pageKey"))
	commitSHA := strings.TrimSpace(r.URL.Query().Get("commitSha"))
	if pageKey == "" {
		platformhttp.WriteBadRequest(w, "pageKey is required")
		return
	}
	if commitSHA == "" {
		platformhttp.WriteBadRequest(w, "commitSha is required")
		return
	}

	includeStale := false
	if raw := r.URL.Query().Get("includeStale"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			platformhttp.WriteBadRequest(w, "includeStale must be true or false")
			return
		}
		includeStale = parsed
	}

	environment := strings.TrimSpace(r.URL.Query().Get("environment"))
	threads, err := h.service.ListThreads(r.Context(), annotationsdomain.ListThreadsInput{
		ProjectID:    project.ProjectID,
		PageKey:      pageKey,
		CommitSHA:    commitSHA,
		IncludeStale: includeStale,
		Environment:  environment,
	})
	if err != nil {
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "threads": threads})
}

type createThreadRequest struct {
	PageKey     string          `json:"pageKey"`
	CommitSHA   string          `json:"commitSha"`
	Anchor      json.RawMessage `json:"anchor"`
	Body        string          `json:"body"`
	Author      string          `json:"author"`
	Environment string          `json:"environment"`
}

func (h *Handler) HandleCreateThread(w http.ResponseWriter, r *http.Request) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	var payload createThreadRequest
	if err := platformhttp.DecodeJSON(r, &payload); err != nil {
		platformhttp.WriteBadRequest(w, err.Error())
		return
	}

	if payload.PageKey == "" || payload.CommitSHA == "" || payload.Body == "" || len(payload.Anchor) == 0 {
		platformhttp.WriteBadRequest(w, "pageKey, commitSha, anchor and body are required")
		return
	}

	thread, err := h.service.CreateThread(r.Context(), annotationsdomain.CreateThreadInput{
		ProjectID:   project.ProjectID,
		Environment: strings.TrimSpace(payload.Environment),
		PageKey:     strings.TrimSpace(payload.PageKey),
		CommitSHA:   strings.TrimSpace(payload.CommitSHA),
		Anchor:      payload.Anchor,
		Body:        strings.TrimSpace(payload.Body),
		Author:      strings.TrimSpace(payload.Author),
	})
	if err != nil {
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{
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

func (h *Handler) HandleReplyThread(w http.ResponseWriter, r *http.Request) {
	h.handleThreadReplyLike(w, r, "reply")
}

func (h *Handler) HandleResolveThread(w http.ResponseWriter, r *http.Request) {
	h.handleThreadReplyLike(w, r, "resolve")
}

func (h *Handler) HandleReopenThread(w http.ResponseWriter, r *http.Request) {
	h.handleThreadReplyLike(w, r, "reopen")
}

func (h *Handler) handleThreadReplyLike(w http.ResponseWriter, r *http.Request, action string) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	threadID := strings.TrimSpace(r.PathValue("threadID"))
	if threadID == "" {
		platformhttp.WriteBadRequest(w, "threadID is required")
		return
	}

	switch action {
	case "reply":
		var payload replyRequest
		if err := platformhttp.DecodeJSON(r, &payload); err != nil {
			platformhttp.WriteBadRequest(w, err.Error())
			return
		}
		if payload.PageKey == "" || payload.CommitSHA == "" || strings.TrimSpace(payload.Body) == "" {
			platformhttp.WriteBadRequest(w, "pageKey, commitSha and body are required")
			return
		}

		thread, err := h.service.ReplyThread(r.Context(), annotationsdomain.ReplyInput{
			ProjectID: project.ProjectID,
			ThreadID:  threadID,
			PageKey:   strings.TrimSpace(payload.PageKey),
			CommitSHA: strings.TrimSpace(payload.CommitSHA),
			Body:      strings.TrimSpace(payload.Body),
			Author:    strings.TrimSpace(payload.Author),
		})
		if err != nil {
			if errors.Is(err, annotationsapp.ErrThreadNotFound) {
				platformhttp.WriteNotFound(w, "THREAD_NOT_FOUND")
				return
			}
			platformhttp.WriteProviderError(w)
			return
		}

		platformhttp.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": fmt.Sprintf("Reply added to %s.", threadID),
			"thread":  thread,
		})
		return

	case "resolve", "reopen":
		var (
			thread annotationsdomain.Thread
			err    error
		)
		if action == "resolve" {
			thread, err = h.service.ResolveThread(r.Context(), project.ProjectID, threadID)
		} else {
			thread, err = h.service.ReopenThread(r.Context(), project.ProjectID, threadID)
		}
		if err != nil {
			if errors.Is(err, annotationsapp.ErrThreadNotFound) {
				platformhttp.WriteNotFound(w, "THREAD_NOT_FOUND")
				return
			}
			platformhttp.WriteProviderError(w)
			return
		}

		message := "Thread resolved."
		if action == "reopen" {
			message = "Thread reopened."
		}
		platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "message": message, "thread": thread})
		return
	}

	platformhttp.WriteBadRequest(w, "Unsupported action")
}

type moveThreadAnchorRequest struct {
	ThreadID  string          `json:"threadId,omitempty"`
	PageKey   string          `json:"pageKey"`
	CommitSHA string          `json:"commitSha"`
	Anchor    json.RawMessage `json:"anchor"`
}

func (h *Handler) HandleMoveThreadAnchor(w http.ResponseWriter, r *http.Request) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	threadID := strings.TrimSpace(r.PathValue("threadID"))
	if threadID == "" {
		platformhttp.WriteBadRequest(w, "threadID is required")
		return
	}

	var payload moveThreadAnchorRequest
	if err := platformhttp.DecodeJSON(r, &payload); err != nil {
		platformhttp.WriteBadRequest(w, err.Error())
		return
	}

	if payload.PageKey == "" || payload.CommitSHA == "" || len(payload.Anchor) == 0 {
		platformhttp.WriteBadRequest(w, "pageKey, commitSha and anchor are required")
		return
	}
	if payload.ThreadID != "" && strings.TrimSpace(payload.ThreadID) != threadID {
		platformhttp.WriteBadRequest(w, "threadId mismatch")
		return
	}

	thread, err := h.service.MoveThreadAnchor(r.Context(), annotationsdomain.MoveThreadAnchorInput{
		ProjectID: project.ProjectID,
		ThreadID:  threadID,
		PageKey:   strings.TrimSpace(payload.PageKey),
		CommitSHA: strings.TrimSpace(payload.CommitSHA),
		Anchor:    payload.Anchor,
	})
	if err != nil {
		if errors.Is(err, annotationsapp.ErrThreadNotFound) {
			platformhttp.WriteNotFound(w, "THREAD_NOT_FOUND")
			return
		}
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Thread anchor updated.", "thread": thread})
}

func (h *Handler) HandleDeleteThread(w http.ResponseWriter, r *http.Request) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	threadID := strings.TrimSpace(r.PathValue("threadID"))
	pageKey := strings.TrimSpace(r.URL.Query().Get("pageKey"))
	commitSHA := strings.TrimSpace(r.URL.Query().Get("commitSha"))
	if threadID == "" || pageKey == "" || commitSHA == "" {
		platformhttp.WriteBadRequest(w, "threadID, pageKey and commitSha are required")
		return
	}

	err := h.service.DeleteThread(r.Context(), annotationsdomain.DeleteThreadInput{
		ProjectID: project.ProjectID,
		ThreadID:  threadID,
		PageKey:   pageKey,
		CommitSHA: commitSHA,
	})
	if err != nil {
		if errors.Is(err, annotationsapp.ErrThreadNotFound) {
			platformhttp.WriteNotFound(w, "THREAD_NOT_FOUND")
			return
		}
		platformhttp.WriteProviderError(w)
		return
	}

	platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Thread deleted."})
}

func (h *Handler) HandleListCommitHistory(w http.ResponseWriter, r *http.Request) {
	project, ok := middleware.ProjectFromContext(r.Context())
	if !ok {
		platformhttp.WriteAuthRequired(w)
		return
	}

	pageKey := strings.TrimSpace(r.URL.Query().Get("pageKey"))
	if pageKey == "" {
		platformhttp.WriteBadRequest(w, "pageKey is required")
		return
	}
	environment := strings.TrimSpace(r.URL.Query().Get("environment"))

	result, err := h.service.ListCommitHistory(r.Context(), project, pageKey, environment)
	if err != nil {
		platformhttp.WriteProviderError(w)
		return
	}

	response := map[string]any{"ok": true, "commits": result.Commits}
	if result.WarningCode != "" {
		response["warningCode"] = result.WarningCode
	}
	platformhttp.WriteJSON(w, http.StatusOK, response)
}

func RegisterRoutes(mux *http.ServeMux, handler *Handler, requireAPIKey middleware.Middleware) {
	mux.Handle("POST /v1/annotations/resolve", requireAPIKey(http.HandlerFunc(handler.HandleResolveProject)))
	mux.Handle("GET /v1/threads", requireAPIKey(http.HandlerFunc(handler.HandleListThreads)))
	mux.Handle("GET /v1/commit-history", requireAPIKey(http.HandlerFunc(handler.HandleListCommitHistory)))
	mux.Handle("POST /v1/threads", requireAPIKey(http.HandlerFunc(handler.HandleCreateThread)))
	mux.Handle("POST /v1/threads/{threadID}/replies", requireAPIKey(http.HandlerFunc(handler.HandleReplyThread)))
	mux.Handle("POST /v1/threads/{threadID}/resolve", requireAPIKey(http.HandlerFunc(handler.HandleResolveThread)))
	mux.Handle("POST /v1/threads/{threadID}/reopen", requireAPIKey(http.HandlerFunc(handler.HandleReopenThread)))
	mux.Handle("PATCH /v1/threads/{threadID}/anchor", requireAPIKey(http.HandlerFunc(handler.HandleMoveThreadAnchor)))
	mux.Handle("DELETE /v1/threads/{threadID}", requireAPIKey(http.HandlerFunc(handler.HandleDeleteThread)))
}
