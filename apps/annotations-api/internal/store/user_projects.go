package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type UserProject struct {
	ProjectID    string    `json:"projectId"`
	Name         string    `json:"name"`
	RepoOwner    string    `json:"repoOwner,omitempty"`
	RepoName     string    `json:"repoName,omitempty"`
	RepoFullName string    `json:"repoFullName,omitempty"`
	RepoHTMLURL  string    `json:"repoHtmlUrl,omitempty"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CreateUserProjectInput struct {
	OwnerUserID  string
	Name         string
	RepoOwner    string
	RepoName     string
	RepoFullName string
	RepoHTMLURL  string
}

type UserAPIKey struct {
	KeyID      string     `json:"keyId"`
	ProjectID  string     `json:"projectId"`
	Preview    string     `json:"preview"`
	Active     bool       `json:"active"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

type CreatedUserAPIKey struct {
	KeyID     string    `json:"keyId"`
	ProjectID string    `json:"projectId"`
	APIKey    string    `json:"apiKey"`
	CreatedAt time.Time `json:"createdAt"`
}

type UserAPIKeyWithProject struct {
	KeyID        string     `json:"keyId"`
	ProjectID    string     `json:"projectId"`
	ProjectName  string     `json:"projectName"`
	RepoFullName string     `json:"repoFullName,omitempty"`
	Preview      string     `json:"preview"`
	Active       bool       `json:"active"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
}

type CreateUserAPIKeyForRepoInput struct {
	OwnerUserID  string
	Name         string
	RepoOwner    string
	RepoName     string
	RepoFullName string
	RepoHTMLURL  string
}

func (s *Store) ListUserProjects(ctx context.Context, ownerUserID string) ([]UserProject, error) {
	rows, err := s.db.Query(ctx, `
		select project_id, name, coalesce(repo_owner, ''), coalesce(repo_name, ''), coalesce(repo_full_name, ''), coalesce(repo_html_url, ''), active, created_at
		from projects
		where owner_user_id = $1
		order by created_at desc
	`, strings.TrimSpace(ownerUserID))
	if err != nil {
		return nil, fmt.Errorf("list user projects: %w", err)
	}
	defer rows.Close()

	projects := make([]UserProject, 0)
	for rows.Next() {
		var project UserProject
		if err := rows.Scan(
			&project.ProjectID,
			&project.Name,
			&project.RepoOwner,
			&project.RepoName,
			&project.RepoFullName,
			&project.RepoHTMLURL,
			&project.Active,
			&project.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user project: %w", err)
		}
		projects = append(projects, project)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user projects: %w", err)
	}

	return projects, nil
}

func (s *Store) CreateUserProject(ctx context.Context, input CreateUserProjectInput) (UserProject, error) {
	ownerUserID := strings.TrimSpace(input.OwnerUserID)
	trimmedName := strings.TrimSpace(input.Name)
	repoOwner := strings.TrimSpace(input.RepoOwner)
	repoName := strings.TrimSpace(input.RepoName)
	repoFullName := strings.TrimSpace(input.RepoFullName)
	repoHTMLURL := strings.TrimSpace(input.RepoHTMLURL)
	if ownerUserID == "" {
		return UserProject{}, fmt.Errorf("owner user id is required")
	}
	if trimmedName == "" {
		return UserProject{}, fmt.Errorf("project name is required")
	}
	if repoOwner == "" || repoName == "" || repoFullName == "" {
		return UserProject{}, fmt.Errorf("repo owner, repo name and repo full name are required")
	}

	now := time.Now().UTC()
	projectID := randomID("proj")

	if _, err := s.db.Exec(ctx, `
		insert into projects(project_id, name, repo_owner, repo_name, repo_full_name, repo_html_url, active, created_at, owner_user_id)
		values($1, $2, $3, $4, $5, $6, true, $7, $8)
	`, projectID, trimmedName, repoOwner, repoName, repoFullName, nullIfEmpty(repoHTMLURL), now, ownerUserID); err != nil {
		if strings.Contains(err.Error(), "idx_projects_owner_repo_full_name_unique") {
			return UserProject{}, ErrConflict
		}
		return UserProject{}, fmt.Errorf("create user project: %w", err)
	}

	return UserProject{
		ProjectID:    projectID,
		Name:         trimmedName,
		RepoOwner:    repoOwner,
		RepoName:     repoName,
		RepoFullName: repoFullName,
		RepoHTMLURL:  repoHTMLURL,
		Active:       true,
		CreatedAt:    now,
	}, nil
}

func (s *Store) ListUserProjectAPIKeys(ctx context.Context, ownerUserID, projectID string) ([]UserAPIKey, error) {
	rows, err := s.db.Query(ctx, `
		select k.key_id, k.project_id, k.api_key, k.active, k.created_at, k.last_used_at
		from api_keys k
		join projects p on p.project_id = k.project_id
		where p.owner_user_id = $1 and k.project_id = $2
		order by k.created_at desc
	`, strings.TrimSpace(ownerUserID), strings.TrimSpace(projectID))
	if err != nil {
		return nil, fmt.Errorf("list user project api keys: %w", err)
	}
	defer rows.Close()

	keys := make([]UserAPIKey, 0)
	for rows.Next() {
		var (
			key       UserAPIKey
			apiKeyRaw string
		)
		if err := rows.Scan(&key.KeyID, &key.ProjectID, &apiKeyRaw, &key.Active, &key.CreatedAt, &key.LastUsedAt); err != nil {
			return nil, fmt.Errorf("scan user api key: %w", err)
		}
		key.Preview = previewAPIKey(apiKeyRaw)
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user api keys: %w", err)
	}
	return keys, nil
}

func (s *Store) CreateUserProjectAPIKey(ctx context.Context, ownerUserID, projectID string) (CreatedUserAPIKey, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	projectID = strings.TrimSpace(projectID)
	if ownerUserID == "" || projectID == "" {
		return CreatedUserAPIKey{}, fmt.Errorf("owner user id and project id are required")
	}

	var exists bool
	if err := s.db.QueryRow(ctx, `
		select exists(
			select 1
			from projects
			where project_id = $1 and owner_user_id = $2 and active = true
		)
	`, projectID, ownerUserID).Scan(&exists); err != nil {
		return CreatedUserAPIKey{}, fmt.Errorf("check user project exists: %w", err)
	}
	if !exists {
		return CreatedUserAPIKey{}, ErrNotFound
	}

	createdAt := time.Now().UTC()
	keyID := randomID("key")
	apiKey := generatePublicAPIKey()

	if _, err := s.db.Exec(ctx, `
		insert into api_keys(key_id, project_id, api_key, active, created_at)
		values($1, $2, $3, true, $4)
	`, keyID, projectID, apiKey, createdAt); err != nil {
		return CreatedUserAPIKey{}, fmt.Errorf("create user project api key: %w", err)
	}

	return CreatedUserAPIKey{
		KeyID:     keyID,
		ProjectID: projectID,
		APIKey:    apiKey,
		CreatedAt: createdAt,
	}, nil
}

func (s *Store) RevokeUserProjectAPIKey(ctx context.Context, ownerUserID, projectID, keyID string) error {
	commandTag, err := s.db.Exec(ctx, `
		update api_keys k
		set active = false
		from projects p
		where
			k.project_id = p.project_id
			and p.owner_user_id = $1
			and p.project_id = $2
			and k.key_id = $3
	`, strings.TrimSpace(ownerUserID), strings.TrimSpace(projectID), strings.TrimSpace(keyID))
	if err != nil {
		return fmt.Errorf("revoke user project api key: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListUserAPIKeys(ctx context.Context, ownerUserID string) ([]UserAPIKeyWithProject, error) {
	rows, err := s.db.Query(ctx, `
		select
			k.key_id,
			k.project_id,
			p.name,
			coalesce(p.repo_full_name, ''),
			k.api_key,
			k.active,
			k.created_at,
			k.last_used_at
		from api_keys k
		join projects p on p.project_id = k.project_id
		where p.owner_user_id = $1
		order by k.created_at desc
	`, strings.TrimSpace(ownerUserID))
	if err != nil {
		return nil, fmt.Errorf("list user api keys: %w", err)
	}
	defer rows.Close()

	keys := make([]UserAPIKeyWithProject, 0)
	for rows.Next() {
		var (
			key       UserAPIKeyWithProject
			apiKeyRaw string
		)
		if err := rows.Scan(
			&key.KeyID,
			&key.ProjectID,
			&key.ProjectName,
			&key.RepoFullName,
			&apiKeyRaw,
			&key.Active,
			&key.CreatedAt,
			&key.LastUsedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user api key with project: %w", err)
		}
		key.Preview = previewAPIKey(apiKeyRaw)
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user api keys: %w", err)
	}
	return keys, nil
}

func (s *Store) CreateUserAPIKeyForRepo(ctx context.Context, input CreateUserAPIKeyForRepoInput) (CreatedUserAPIKey, UserProject, error) {
	ownerUserID := strings.TrimSpace(input.OwnerUserID)
	repoOwner := strings.TrimSpace(input.RepoOwner)
	repoName := strings.TrimSpace(input.RepoName)
	repoFullName := strings.TrimSpace(input.RepoFullName)
	repoHTMLURL := strings.TrimSpace(input.RepoHTMLURL)
	projectName := strings.TrimSpace(input.Name)
	if ownerUserID == "" || repoOwner == "" || repoName == "" || repoFullName == "" || projectName == "" {
		return CreatedUserAPIKey{}, UserProject{}, fmt.Errorf("owner user id, project name and repo fields are required")
	}

	project, err := s.findUserProjectByRepo(ctx, ownerUserID, repoFullName)
	if err != nil && err != ErrNotFound {
		return CreatedUserAPIKey{}, UserProject{}, fmt.Errorf("lookup user project by repo: %w", err)
	}

	if err == ErrNotFound {
		project, err = s.CreateUserProject(ctx, CreateUserProjectInput{
			OwnerUserID:  ownerUserID,
			Name:         projectName,
			RepoOwner:    repoOwner,
			RepoName:     repoName,
			RepoFullName: repoFullName,
			RepoHTMLURL:  repoHTMLURL,
		})
		if err != nil {
			if err == ErrConflict {
				project, err = s.findUserProjectByRepo(ctx, ownerUserID, repoFullName)
				if err != nil {
					return CreatedUserAPIKey{}, UserProject{}, fmt.Errorf("resolve raced project creation: %w", err)
				}
			} else {
				return CreatedUserAPIKey{}, UserProject{}, err
			}
		}
	}

	createdKey, err := s.CreateUserProjectAPIKey(ctx, ownerUserID, project.ProjectID)
	if err != nil {
		return CreatedUserAPIKey{}, UserProject{}, err
	}

	return createdKey, project, nil
}

func (s *Store) DeleteUserAPIKey(ctx context.Context, ownerUserID, keyID string) error {
	commandTag, err := s.db.Exec(ctx, `
		delete from api_keys k
		using projects p
		where
			k.project_id = p.project_id
			and p.owner_user_id = $1
			and k.key_id = $2
	`, strings.TrimSpace(ownerUserID), strings.TrimSpace(keyID))
	if err != nil {
		return fmt.Errorf("delete user api key: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) findUserProjectByRepo(ctx context.Context, ownerUserID, repoFullName string) (UserProject, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	repoFullName = strings.TrimSpace(repoFullName)
	var project UserProject
	err := s.db.QueryRow(ctx, `
		select
			project_id,
			name,
			coalesce(repo_owner, ''),
			coalesce(repo_name, ''),
			coalesce(repo_full_name, ''),
			coalesce(repo_html_url, ''),
			active,
			created_at
		from projects
		where owner_user_id = $1 and lower(repo_full_name) = lower($2)
		limit 1
	`, ownerUserID, repoFullName).Scan(
		&project.ProjectID,
		&project.Name,
		&project.RepoOwner,
		&project.RepoName,
		&project.RepoFullName,
		&project.RepoHTMLURL,
		&project.Active,
		&project.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return UserProject{}, ErrNotFound
		}
		return UserProject{}, fmt.Errorf("find user project by repo: %w", err)
	}
	return project, nil
}
