package middleware

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	accountdomain "github.com/deshlo/annotations-api/internal/modules/account/domain"
	authdomain "github.com/deshlo/annotations-api/internal/modules/auth/domain"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
	platformhttp "github.com/deshlo/annotations-api/internal/platform/http"
	security "github.com/deshlo/annotations-api/internal/platform/security"
)

type Middleware func(http.Handler) http.Handler

type contextKey string

const projectContextKey contextKey = "project"
const userContextKey contextKey = "user"

type APIKeyProjectResolver interface {
	ResolveProjectByAPIKey(ctx context.Context, apiKey string) (accountdomain.Project, error)
}

type UserResolver interface {
	GetUserByID(ctx context.Context, userID string) (authdomain.User, error)
}

func NewAPIKeyAuth(resolver APIKeyProjectResolver, logger *log.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			apiKey := parseAPIKey(r)
			if apiKey == "" {
				platformhttp.WriteAuthRequired(w)
				return
			}

			project, err := resolver.ResolveProjectByAPIKey(r.Context(), apiKey)
			if err != nil {
				if errors.Is(err, platformerrors.ErrNotFound) {
					platformhttp.WriteAuthRequired(w)
					return
				}
				logger.Printf("api key auth error: %v", err)
				platformhttp.WriteProviderError(w)
				return
			}

			ctx := context.WithValue(r.Context(), projectContextKey, project)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func NewUserAuth(jwtSecret string, resolver UserResolver, logger *log.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			token := parseBearerToken(r)
			if token == "" {
				platformhttp.WriteAuthRequired(w)
				return
			}

			claims, err := security.ParseUserToken(jwtSecret, token)
			if err != nil {
				platformhttp.WriteAuthRequired(w)
				return
			}

			user, err := resolver.GetUserByID(r.Context(), claims.UserID)
			if err != nil {
				if errors.Is(err, platformerrors.ErrNotFound) {
					platformhttp.WriteAuthRequired(w)
					return
				}
				logger.Printf("user auth lookup error: %v", err)
				platformhttp.WriteProviderError(w)
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func WithCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Deshlo-API-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func ProjectFromContext(ctx context.Context) (accountdomain.Project, bool) {
	project, ok := ctx.Value(projectContextKey).(accountdomain.Project)
	return project, ok
}

func UserFromContext(ctx context.Context) (authdomain.User, bool) {
	user, ok := ctx.Value(userContextKey).(authdomain.User)
	return user, ok
}

func parseAPIKey(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-Deshlo-API-Key"))
}

func parseBearerToken(r *http.Request) string {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
		return strings.TrimSpace(authorization[len("Bearer "):])
	}
	return ""
}
