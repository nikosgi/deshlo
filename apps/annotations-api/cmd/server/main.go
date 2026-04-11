package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	accountapp "github.com/deshlo/annotations-api/internal/modules/account/application"
	accounthttp "github.com/deshlo/annotations-api/internal/modules/account/http"
	accountinfra "github.com/deshlo/annotations-api/internal/modules/account/infra"
	annotationsapp "github.com/deshlo/annotations-api/internal/modules/annotations/application"
	annotationshttp "github.com/deshlo/annotations-api/internal/modules/annotations/http"
	annotationsinfra "github.com/deshlo/annotations-api/internal/modules/annotations/infra"
	authapp "github.com/deshlo/annotations-api/internal/modules/auth/application"
	authhttp "github.com/deshlo/annotations-api/internal/modules/auth/http"
	authinfra "github.com/deshlo/annotations-api/internal/modules/auth/infra"
	githubinfra "github.com/deshlo/annotations-api/internal/modules/github/infra"
	platformconfig "github.com/deshlo/annotations-api/internal/platform/config"
	platformdb "github.com/deshlo/annotations-api/internal/platform/db"
	platformmigrate "github.com/deshlo/annotations-api/internal/platform/db/migrate"
	"github.com/deshlo/annotations-api/internal/platform/middleware"
	"github.com/deshlo/annotations-api/internal/platform/observability"
	platformsecurity "github.com/deshlo/annotations-api/internal/platform/security"
	platformserver "github.com/deshlo/annotations-api/internal/platform/server"
)

func main() {
	logger := observability.NewLogger()

	cfg, err := platformconfig.Load()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}

	ctx := context.Background()
	db, err := platformdb.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatalf("connect postgres: %v", err)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		logger.Fatalf("ping postgres: %v", err)
	}

	if cfg.MigrateOnStart {
		if err := platformmigrate.Apply(ctx, db, "migrations"); err != nil {
			logger.Fatalf("apply migrations: %v", err)
		}
		logger.Printf("migrations applied")
	}

	tokenCipher, err := platformsecurity.NewTokenCipher(cfg.TokenEncryptionKey)
	if err != nil {
		logger.Fatalf("initialize token cipher: %v", err)
	}

	githubClient := githubinfra.NewClient(cfg.GitHubClientID, cfg.GitHubClientSecret, cfg.GitHubRedirectURL)

	authRepo := authinfra.NewUserRepository(db, tokenCipher)
	accountRepo := accountinfra.NewRepository(db)
	annotationsRepo := annotationsinfra.NewRepository(db)

	authService := authapp.NewService(authRepo, githubClient, authapp.OAuthConfig{
		DashboardURL: cfg.DashboardURL,
		JWTSecret:    cfg.JWTSecret,
		JWTTTL:       time.Duration(cfg.JWTTTLSeconds) * time.Second,
	}, logger)
	accountService := accountapp.NewService(accountRepo, authService, githubClient, logger)
	annotationsService := annotationsapp.NewService(annotationsRepo, authService, githubClient, logger)

	authHandler := authhttp.NewHandler(authService)
	accountHandler := accounthttp.NewHandler(accountService)
	annotationsHandler := annotationshttp.NewHandler(annotationsService)

	userAuthMiddleware := middleware.NewUserAuth(cfg.JWTSecret, authService, logger)
	apiKeyAuthMiddleware := middleware.NewAPIKeyAuth(annotationsRepo, logger)

	httpServer := &http.Server{
		Addr: ":" + strconv.Itoa(cfg.Port),
		Handler: platformserver.NewHandler(platformserver.RouterConfig{
			AuthHandler:        authHandler,
			AccountHandler:     accountHandler,
			AnnotationsHandler: annotationsHandler,
			RequireUser:        userAuthMiddleware,
			RequireAPIKey:      apiKeyAuthMiddleware,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Printf("listening on http://localhost:%d", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("http server: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Printf("graceful shutdown failed: %v", err)
		_ = httpServer.Close()
	}

	logger.Printf("shutdown complete")
}
