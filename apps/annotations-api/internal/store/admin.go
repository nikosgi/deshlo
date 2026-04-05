package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type AdminProject struct {
	ProjectID string    `json:"projectId"`
	Name      string    `json:"name"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

type AdminAPIKey struct {
	KeyID      string     `json:"keyId"`
	ProjectID  string     `json:"projectId"`
	Preview    string     `json:"preview"`
	Active     bool       `json:"active"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

type CreatedAdminAPIKey struct {
	KeyID     string    `json:"keyId"`
	ProjectID string    `json:"projectId"`
	APIKey    string    `json:"apiKey"`
	CreatedAt time.Time `json:"createdAt"`
}

func (s *Store) ListProjects(ctx context.Context) ([]AdminProject, error) {
	rows, err := s.db.Query(ctx, `
		select project_id, name, active, created_at
		from projects
		order by created_at desc
	`)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	projects := make([]AdminProject, 0)
	for rows.Next() {
		var project AdminProject
		if err := rows.Scan(&project.ProjectID, &project.Name, &project.Active, &project.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		projects = append(projects, project)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects: %w", err)
	}

	return projects, nil
}

func (s *Store) CreateProject(ctx context.Context, name string) (AdminProject, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return AdminProject{}, fmt.Errorf("project name is required")
	}

	now := time.Now().UTC()
	projectID := randomID("proj")

	if _, err := s.db.Exec(ctx, `
		insert into projects(project_id, name, active, created_at)
		values($1, $2, true, $3)
	`, projectID, trimmed, now); err != nil {
		return AdminProject{}, fmt.Errorf("create project: %w", err)
	}

	return AdminProject{
		ProjectID: projectID,
		Name:      trimmed,
		Active:    true,
		CreatedAt: now,
	}, nil
}

func (s *Store) ListProjectAPIKeys(ctx context.Context, projectID string) ([]AdminAPIKey, error) {
	rows, err := s.db.Query(ctx, `
		select key_id, project_id, api_key, active, created_at, last_used_at
		from api_keys
		where project_id = $1
		order by created_at desc
	`, strings.TrimSpace(projectID))
	if err != nil {
		return nil, fmt.Errorf("list project api keys: %w", err)
	}
	defer rows.Close()

	keys := make([]AdminAPIKey, 0)
	for rows.Next() {
		var (
			key       AdminAPIKey
			apiKeyRaw string
		)
		if err := rows.Scan(
			&key.KeyID,
			&key.ProjectID,
			&apiKeyRaw,
			&key.Active,
			&key.CreatedAt,
			&key.LastUsedAt,
		); err != nil {
			return nil, fmt.Errorf("scan api key: %w", err)
		}
		key.Preview = previewAPIKey(apiKeyRaw)
		keys = append(keys, key)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate api keys: %w", err)
	}

	return keys, nil
}

func (s *Store) CreateProjectAPIKey(ctx context.Context, projectID string) (CreatedAdminAPIKey, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return CreatedAdminAPIKey{}, fmt.Errorf("project id is required")
	}

	var exists bool
	if err := s.db.QueryRow(ctx, `select exists(select 1 from projects where project_id = $1 and active = true)`, projectID).Scan(&exists); err != nil {
		return CreatedAdminAPIKey{}, fmt.Errorf("check project exists: %w", err)
	}
	if !exists {
		return CreatedAdminAPIKey{}, ErrNotFound
	}

	createdAt := time.Now().UTC()
	keyID := randomID("key")
	apiKey := generatePublicAPIKey()

	if _, err := s.db.Exec(ctx, `
		insert into api_keys(key_id, project_id, api_key, active, created_at)
		values($1, $2, $3, true, $4)
	`, keyID, projectID, apiKey, createdAt); err != nil {
		return CreatedAdminAPIKey{}, fmt.Errorf("create project api key: %w", err)
	}

	return CreatedAdminAPIKey{
		KeyID:     keyID,
		ProjectID: projectID,
		APIKey:    apiKey,
		CreatedAt: createdAt,
	}, nil
}

func previewAPIKey(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:8] + "..." + value[len(value)-4:]
}

func generatePublicAPIKey() string {
	return "pk_live_" + randomToken(18)
}
