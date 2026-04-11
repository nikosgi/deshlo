package migrate

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Apply(ctx context.Context, db *pgxpool.Pool, migrationsDir string) error {
	if migrationsDir == "" {
		migrationsDir = "migrations"
	}

	if _, err := db.Exec(ctx, `
		create table if not exists schema_migrations (
			version text primary key,
			applied_at timestamptz not null default now()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}

	versions := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".sql" {
			continue
		}
		versions = append(versions, entry.Name())
	}
	sort.Strings(versions)

	for _, version := range versions {
		var applied bool
		if err := db.QueryRow(ctx, `select exists(select 1 from schema_migrations where version = $1)`, version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", version, err)
		}
		if applied {
			continue
		}

		path := filepath.Join(migrationsDir, version)
		bytes, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}

		sql := strings.TrimSpace(string(bytes))
		if sql == "" {
			continue
		}

		tx, err := db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration tx %s: %w", version, err)
		}

		if _, err := tx.Exec(ctx, sql); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("run migration %s: %w", version, err)
		}

		if _, err := tx.Exec(ctx, `insert into schema_migrations(version) values($1)`, version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", version, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", version, err)
		}
	}

	return nil
}
