package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port               int
	DatabaseURL        string
	MigrateOnStart     bool
	DefaultProjectID   string
	AdminToken         string
	JWTSecret          string
	JWTTTLSeconds      int
	GitHubClientID     string
	GitHubClientSecret string
	GitHubRedirectURL  string
	DashboardURL       string
}

func Load() (Config, error) {
	port := 8080
	if raw := os.Getenv("PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return Config{}, fmt.Errorf("parse PORT: %w", err)
		}
		port = parsed
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}

	migrateOnStart := os.Getenv("MIGRATE_ON_START") == "1"
	defaultProjectID := os.Getenv("DEFAULT_PROJECT_ID")
	adminToken := os.Getenv("DESHLO_ADMIN_TOKEN")
	jwtSecret := os.Getenv("DESHLO_JWT_SECRET")
	if jwtSecret == "" {
		return Config{}, fmt.Errorf("DESHLO_JWT_SECRET is required")
	}

	jwtTTLSeconds := 3600
	if raw := os.Getenv("DESHLO_JWT_TTL_SECONDS"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return Config{}, fmt.Errorf("parse DESHLO_JWT_TTL_SECONDS: %w", err)
		}
		jwtTTLSeconds = parsed
	}

	githubClientID := os.Getenv("GITHUB_CLIENT_ID")
	githubClientSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	githubRedirectURL := os.Getenv("GITHUB_REDIRECT_URL")
	dashboardURL := os.Getenv("DASHBOARD_URL")

	if githubClientID == "" || githubClientSecret == "" || githubRedirectURL == "" || dashboardURL == "" {
		return Config{}, fmt.Errorf("GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URL and DASHBOARD_URL are required")
	}

	return Config{
		Port:               port,
		DatabaseURL:        databaseURL,
		MigrateOnStart:     migrateOnStart,
		DefaultProjectID:   defaultProjectID,
		AdminToken:         adminToken,
		JWTSecret:          jwtSecret,
		JWTTTLSeconds:      jwtTTLSeconds,
		GitHubClientID:     githubClientID,
		GitHubClientSecret: githubClientSecret,
		GitHubRedirectURL:  githubRedirectURL,
		DashboardURL:       dashboardURL,
	}, nil
}
