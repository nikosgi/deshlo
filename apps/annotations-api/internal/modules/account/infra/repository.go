package infra

import (
	"context"
	"fmt"
	"strings"
	"time"

	accountapp "github.com/deshlo/annotations-api/internal/modules/account/application"
	accountdomain "github.com/deshlo/annotations-api/internal/modules/account/domain"
	"github.com/deshlo/annotations-api/internal/platform/dbutil"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

var _ accountapp.Repository = (*Repository)(nil)

func (r *Repository) ListUserProjects(ctx context.Context, ownerUserID string) ([]accountdomain.UserProject, error) {
	rows, err := r.db.Query(ctx, `
		select project_id, name, coalesce(repo_owner, ''), coalesce(repo_name, ''), coalesce(repo_full_name, ''), coalesce(repo_html_url, ''), active, created_at
		from projects
		where owner_user_id = $1
		order by created_at desc
	`, strings.TrimSpace(ownerUserID))
	if err != nil {
		return nil, fmt.Errorf("list user projects: %w", err)
	}
	defer rows.Close()

	projects := make([]accountdomain.UserProject, 0)
	for rows.Next() {
		var project accountdomain.UserProject
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

func (r *Repository) ListUserAPIKeys(ctx context.Context, ownerUserID string) ([]accountdomain.UserAPIKeyWithProject, error) {
	rows, err := r.db.Query(ctx, `
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

	keys := make([]accountdomain.UserAPIKeyWithProject, 0)
	for rows.Next() {
		var (
			key       accountdomain.UserAPIKeyWithProject
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

func (r *Repository) CreateUserAPIKeyForRepo(
	ctx context.Context,
	input accountdomain.CreateUserAPIKeyForRepoInput,
) (accountdomain.CreatedUserAPIKey, accountdomain.UserProject, error) {
	ownerUserID := strings.TrimSpace(input.OwnerUserID)
	repoOwner := strings.TrimSpace(input.RepoOwner)
	repoName := strings.TrimSpace(input.RepoName)
	repoFullName := strings.TrimSpace(input.RepoFullName)
	repoHTMLURL := strings.TrimSpace(input.RepoHTMLURL)
	projectName := strings.TrimSpace(input.Name)
	if ownerUserID == "" || repoOwner == "" || repoName == "" || repoFullName == "" || projectName == "" {
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, fmt.Errorf("owner user id, project name and repo fields are required")
	}

	project, err := r.findUserProjectByRepo(ctx, ownerUserID, repoFullName)
	if err != nil && err != platformerrors.ErrNotFound {
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, fmt.Errorf("lookup user project by repo: %w", err)
	}

	if err == platformerrors.ErrNotFound {
		project, err = r.createUserProject(ctx, accountdomain.CreateUserProjectInput{
			OwnerUserID:  ownerUserID,
			Name:         projectName,
			RepoOwner:    repoOwner,
			RepoName:     repoName,
			RepoFullName: repoFullName,
			RepoHTMLURL:  repoHTMLURL,
		})
		if err != nil {
			if err == platformerrors.ErrConflict {
				project, err = r.findUserProjectByRepo(ctx, ownerUserID, repoFullName)
				if err != nil {
					return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, fmt.Errorf("resolve raced project creation: %w", err)
				}
			} else {
				return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, err
			}
		}
	}

	createdKey, err := r.createUserProjectAPIKey(ctx, ownerUserID, project.ProjectID)
	if err != nil {
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, err
	}

	return createdKey, project, nil
}

func (r *Repository) DeleteUserAPIKey(ctx context.Context, ownerUserID, keyID string) error {
	commandTag, err := r.db.Exec(ctx, `
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
		return platformerrors.ErrNotFound
	}
	return nil
}

func (r *Repository) createUserProjectAPIKey(ctx context.Context, ownerUserID, projectID string) (accountdomain.CreatedUserAPIKey, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	projectID = strings.TrimSpace(projectID)
	if ownerUserID == "" || projectID == "" {
		return accountdomain.CreatedUserAPIKey{}, fmt.Errorf("owner user id and project id are required")
	}

	var exists bool
	if err := r.db.QueryRow(ctx, `
		select exists(
			select 1
			from projects
			where project_id = $1 and owner_user_id = $2 and active = true
		)
	`, projectID, ownerUserID).Scan(&exists); err != nil {
		return accountdomain.CreatedUserAPIKey{}, fmt.Errorf("check user project exists: %w", err)
	}
	if !exists {
		return accountdomain.CreatedUserAPIKey{}, platformerrors.ErrNotFound
	}

	createdAt := time.Now().UTC()
	keyID := dbutil.RandomID("key")
	apiKey := generatePublicAPIKey()

	if _, err := r.db.Exec(ctx, `
		insert into api_keys(key_id, project_id, api_key, active, created_at)
		values($1, $2, $3, true, $4)
	`, keyID, projectID, apiKey, createdAt); err != nil {
		return accountdomain.CreatedUserAPIKey{}, fmt.Errorf("create user project api key: %w", err)
	}

	return accountdomain.CreatedUserAPIKey{
		KeyID:     keyID,
		ProjectID: projectID,
		APIKey:    apiKey,
		CreatedAt: createdAt,
	}, nil
}

func (r *Repository) createUserProject(ctx context.Context, input accountdomain.CreateUserProjectInput) (accountdomain.UserProject, error) {
	ownerUserID := strings.TrimSpace(input.OwnerUserID)
	trimmedName := strings.TrimSpace(input.Name)
	repoOwner := strings.TrimSpace(input.RepoOwner)
	repoName := strings.TrimSpace(input.RepoName)
	repoFullName := strings.TrimSpace(input.RepoFullName)
	repoHTMLURL := strings.TrimSpace(input.RepoHTMLURL)
	if ownerUserID == "" {
		return accountdomain.UserProject{}, fmt.Errorf("owner user id is required")
	}
	if trimmedName == "" {
		return accountdomain.UserProject{}, fmt.Errorf("project name is required")
	}
	if repoOwner == "" || repoName == "" || repoFullName == "" {
		return accountdomain.UserProject{}, fmt.Errorf("repo owner, repo name and repo full name are required")
	}

	now := time.Now().UTC()
	projectID := dbutil.RandomID("proj")

	if _, err := r.db.Exec(ctx, `
		insert into projects(project_id, name, repo_owner, repo_name, repo_full_name, repo_html_url, active, created_at, owner_user_id)
		values($1, $2, $3, $4, $5, $6, true, $7, $8)
	`, projectID, trimmedName, repoOwner, repoName, repoFullName, dbutil.NullIfEmpty(repoHTMLURL), now, ownerUserID); err != nil {
		if strings.Contains(err.Error(), "idx_projects_owner_repo_full_name_unique") {
			return accountdomain.UserProject{}, platformerrors.ErrConflict
		}
		return accountdomain.UserProject{}, fmt.Errorf("create user project: %w", err)
	}

	return accountdomain.UserProject{
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

func (r *Repository) findUserProjectByRepo(ctx context.Context, ownerUserID, repoFullName string) (accountdomain.UserProject, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	repoFullName = strings.TrimSpace(repoFullName)
	var project accountdomain.UserProject
	err := r.db.QueryRow(ctx, `
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
		if err == pgx.ErrNoRows {
			return accountdomain.UserProject{}, platformerrors.ErrNotFound
		}
		return accountdomain.UserProject{}, fmt.Errorf("find user project by repo: %w", err)
	}
	return project, nil
}

func previewAPIKey(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:8] + "..." + value[len(value)-4:]
}

func generatePublicAPIKey() string {
	return "pk_live_" + dbutil.RandomToken(18)
}
