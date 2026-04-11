package server_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	accounthttp "github.com/deshlo/annotations-api/internal/modules/account/http"
	annotationshttp "github.com/deshlo/annotations-api/internal/modules/annotations/http"
	authhttp "github.com/deshlo/annotations-api/internal/modules/auth/http"
	platformserver "github.com/deshlo/annotations-api/internal/platform/server"
)

func TestNewMuxRegistersExpectedRoutes(t *testing.T) {
	mux := platformserver.NewMux(platformserver.RouterConfig{
		AuthHandler:        authhttp.NewHandler(nil),
		AccountHandler:     accounthttp.NewHandler(nil),
		AnnotationsHandler: annotationshttp.NewHandler(nil),
	})

	cases := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/healthz"},
		{method: http.MethodGet, path: "/v1/auth/github/start"},
		{method: http.MethodGet, path: "/v1/auth/github/callback"},
		{method: http.MethodPost, path: "/v1/account/logout"},
		{method: http.MethodGet, path: "/v1/account/me"},
		{method: http.MethodGet, path: "/v1/account/repos"},
		{method: http.MethodGet, path: "/v1/account/projects"},
		{method: http.MethodGet, path: "/v1/account/keys"},
		{method: http.MethodPost, path: "/v1/account/keys"},
		{method: http.MethodDelete, path: "/v1/account/keys/key_123"},
		{method: http.MethodPost, path: "/v1/annotations/resolve"},
		{method: http.MethodGet, path: "/v1/threads"},
		{method: http.MethodPost, path: "/v1/threads/thread_123/replies"},
		{method: http.MethodPatch, path: "/v1/threads/thread_123/anchor"},
		{method: http.MethodDelete, path: "/v1/threads/thread_123"},
		{method: http.MethodGet, path: "/v1/commit-history"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		_, pattern := mux.Handler(req)
		if pattern == "" {
			t.Fatalf("expected route to be registered for %s %s", tc.method, tc.path)
		}
	}

	unknownReq := httptest.NewRequest(http.MethodGet, "/v1/not-found", nil)
	_, pattern := mux.Handler(unknownReq)
	if pattern != "" {
		t.Fatalf("expected no route for unknown path, got pattern %q", pattern)
	}

	removedCases := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/v1/me"},
		{method: http.MethodPost, path: "/v1/auth/logout"},
		{method: http.MethodGet, path: "/v1/github/repos"},
		{method: http.MethodGet, path: "/v1/projects"},
		{method: http.MethodGet, path: "/v1/keys"},
		{method: http.MethodGet, path: "/v1/admin/projects"},
		{method: http.MethodPost, path: "/v1/projects/proj_1/keys/key_1/revoke"},
		{method: http.MethodPost, path: "/v1/projects/resolve"},
	}
	for _, tc := range removedCases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		_, pattern := mux.Handler(req)
		if pattern != "" {
			t.Fatalf("expected removed route %s %s to be unregistered, got pattern %q", tc.method, tc.path, pattern)
		}
	}
}
