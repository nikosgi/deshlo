package server

import (
	"net/http"

	accounthttp "github.com/deshlo/annotations-api/internal/modules/account/http"
	annotationshttp "github.com/deshlo/annotations-api/internal/modules/annotations/http"
	authhttp "github.com/deshlo/annotations-api/internal/modules/auth/http"
	platformhttp "github.com/deshlo/annotations-api/internal/platform/http"
	"github.com/deshlo/annotations-api/internal/platform/middleware"
)

type RouterConfig struct {
	AuthHandler        *authhttp.Handler
	AccountHandler     *accounthttp.Handler
	AnnotationsHandler *annotationshttp.Handler
	RequireUser        middleware.Middleware
	RequireAPIKey      middleware.Middleware
}

func NewMux(cfg RouterConfig) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		platformhttp.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	})

	requireUser := ensureMiddleware(cfg.RequireUser)
	requireAPIKey := ensureMiddleware(cfg.RequireAPIKey)

	if cfg.AuthHandler != nil {
		authhttp.RegisterRoutes(mux, cfg.AuthHandler, requireUser)
	}
	if cfg.AccountHandler != nil {
		accounthttp.RegisterRoutes(mux, cfg.AccountHandler, requireUser)
	}
	if cfg.AnnotationsHandler != nil {
		annotationshttp.RegisterRoutes(mux, cfg.AnnotationsHandler, requireAPIKey)
	}

	return mux
}

func NewHandler(cfg RouterConfig) http.Handler {
	return middleware.WithCORS(NewMux(cfg))
}

func ensureMiddleware(mw middleware.Middleware) middleware.Middleware {
	if mw == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return mw
}
