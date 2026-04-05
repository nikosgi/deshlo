package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/deshlo/annotations-api/internal/config"
	"github.com/deshlo/annotations-api/internal/httpapi"
	"github.com/deshlo/annotations-api/internal/migrate"
	"github.com/deshlo/annotations-api/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := log.New(os.Stdout, "[annotations-api] ", log.LstdFlags|log.Lmsgprefix)

	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("load config: %v", err)
	}

	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Fatalf("connect postgres: %v", err)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		logger.Fatalf("ping postgres: %v", err)
	}

	if cfg.MigrateOnStart {
		if err := migrate.Apply(ctx, db, "migrations"); err != nil {
			logger.Fatalf("apply migrations: %v", err)
		}
		logger.Printf("migrations applied")
	}

	st := store.New(db)
	api := httpapi.New(st, logger, cfg.AdminToken, httpapi.GitHubOAuthConfig{
		ClientID:     cfg.GitHubClientID,
		ClientSecret: cfg.GitHubClientSecret,
		RedirectURL:  cfg.GitHubRedirectURL,
		DashboardURL: cfg.DashboardURL,
		JWTSecret:    cfg.JWTSecret,
		JWTTTL:       time.Duration(cfg.JWTTTLSeconds) * time.Second,
	})

	httpServer := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           api.Handler(),
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
