package infra

import (
	"context"
	"fmt"
	"strings"
	"time"

	authapp "github.com/deshlo/annotations-api/internal/modules/auth/application"
	authdomain "github.com/deshlo/annotations-api/internal/modules/auth/domain"
	"github.com/deshlo/annotations-api/internal/platform/dbutil"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type tokenCipher interface {
	Encrypt(plaintext string) (string, error)
	Decrypt(ciphertext string) (string, error)
}

type UserRepository struct {
	db          *pgxpool.Pool
	tokenCipher tokenCipher
}

func NewUserRepository(db *pgxpool.Pool, tokenCipher tokenCipher) *UserRepository {
	return &UserRepository{db: db, tokenCipher: tokenCipher}
}

var _ authapp.UserTokenRepository = (*UserRepository)(nil)

func (r *UserRepository) UpsertGitHubUser(ctx context.Context, input authdomain.UpsertGitHubUserInput) (authdomain.User, error) {
	githubID := strings.TrimSpace(input.GitHubID)
	if githubID == "" {
		return authdomain.User{}, fmt.Errorf("github id is required")
	}

	accessTokenEncrypted, err := r.encryptToken(strings.TrimSpace(input.GitHubAccessToken))
	if err != nil {
		return authdomain.User{}, fmt.Errorf("encrypt github access token: %w", err)
	}
	refreshTokenEncrypted, err := r.encryptToken(strings.TrimSpace(input.GitHubRefreshToken))
	if err != nil {
		return authdomain.User{}, fmt.Errorf("encrypt github refresh token: %w", err)
	}

	now := time.Now().UTC()
	userID := dbutil.RandomID("usr")

	var user authdomain.User
	err = r.db.QueryRow(ctx, `
		insert into users (
			user_id,
			github_id,
			email,
			name,
			avatar_url,
			github_access_token_encrypted,
			github_refresh_token_encrypted,
			github_access_token_expires_at,
			github_refresh_token_expires_at,
			github_last_token_refresh_at,
			github_token_updated_at,
			created_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		on conflict (github_id)
		do update set
			email = excluded.email,
			name = excluded.name,
			avatar_url = excluded.avatar_url,
			github_access_token_encrypted = excluded.github_access_token_encrypted,
			github_refresh_token_encrypted = excluded.github_refresh_token_encrypted,
			github_access_token_expires_at = excluded.github_access_token_expires_at,
			github_refresh_token_expires_at = excluded.github_refresh_token_expires_at,
			github_last_token_refresh_at = excluded.github_last_token_refresh_at,
			github_token_updated_at = excluded.github_token_updated_at
		returning user_id, github_id, coalesce(email, ''), coalesce(name, ''), coalesce(avatar_url, ''), created_at
	`,
		userID,
		githubID,
		dbutil.NullIfEmpty(strings.TrimSpace(input.Email)),
		dbutil.NullIfEmpty(strings.TrimSpace(input.Name)),
		dbutil.NullIfEmpty(strings.TrimSpace(input.AvatarURL)),
		dbutil.NullIfEmpty(accessTokenEncrypted),
		dbutil.NullIfEmpty(refreshTokenEncrypted),
		normalizeTime(input.AccessTokenExpiresAt),
		normalizeTime(input.RefreshTokenExpiresAt),
		normalizeTime(input.LastTokenRefreshAt),
		now,
		now,
	).Scan(&user.UserID, &user.GitHubID, &user.Email, &user.Name, &user.AvatarURL, &user.CreatedAt)
	if err != nil {
		return authdomain.User{}, fmt.Errorf("upsert github user: %w", err)
	}

	return user, nil
}

func (r *UserRepository) GetUserByID(ctx context.Context, userID string) (authdomain.User, error) {
	var user authdomain.User
	err := r.db.QueryRow(ctx, `
		select user_id, github_id, coalesce(email, ''), coalesce(name, ''), coalesce(avatar_url, ''), created_at
		from users
		where user_id = $1
	`, strings.TrimSpace(userID)).Scan(&user.UserID, &user.GitHubID, &user.Email, &user.Name, &user.AvatarURL, &user.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return authdomain.User{}, platformerrors.ErrNotFound
		}
		return authdomain.User{}, fmt.Errorf("get user by id: %w", err)
	}
	return user, nil
}

func (r *UserRepository) GetUserGitHubTokenBundle(ctx context.Context, userID string) (authdomain.GitHubTokenBundle, error) {
	return r.getUserGitHubTokenBundle(ctx, strings.TrimSpace(userID), false, nil)
}

func (r *UserRepository) WithUserGitHubTokenLock(
	ctx context.Context,
	userID string,
	fn func(current authdomain.GitHubTokenBundle) (authdomain.GitHubTokenBundle, error),
) (authdomain.GitHubTokenBundle, error) {
	trimmedUserID := strings.TrimSpace(userID)
	if trimmedUserID == "" {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("user id is required")
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("begin user token tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	current, err := r.getUserGitHubTokenBundle(ctx, trimmedUserID, true, tx)
	if err != nil {
		return authdomain.GitHubTokenBundle{}, err
	}

	updated, err := fn(current)
	if err != nil {
		return authdomain.GitHubTokenBundle{}, err
	}

	accessTokenEncrypted, err := r.encryptToken(strings.TrimSpace(updated.AccessToken))
	if err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("encrypt updated github access token: %w", err)
	}
	refreshTokenEncrypted, err := r.encryptToken(strings.TrimSpace(updated.RefreshToken))
	if err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("encrypt updated github refresh token: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		update users
		set
			github_access_token_encrypted = $2,
			github_refresh_token_encrypted = $3,
			github_access_token_expires_at = $4,
			github_refresh_token_expires_at = $5,
			github_last_token_refresh_at = $6,
			github_token_updated_at = $7
		where user_id = $1
	`,
		trimmedUserID,
		dbutil.NullIfEmpty(accessTokenEncrypted),
		dbutil.NullIfEmpty(refreshTokenEncrypted),
		normalizeTime(updated.AccessTokenExpiresAt),
		normalizeTime(updated.RefreshTokenExpiresAt),
		normalizeTime(updated.LastTokenRefreshAt),
		normalizeTime(updated.TokenUpdatedAt),
	); err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("update user github token bundle: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("commit user github token tx: %w", err)
	}

	return updated, nil
}

func (r *UserRepository) getUserGitHubTokenBundle(
	ctx context.Context,
	userID string,
	forUpdate bool,
	tx pgx.Tx,
) (authdomain.GitHubTokenBundle, error) {
	if userID == "" {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("user id is required")
	}

	query := `
		select
			coalesce(github_access_token_encrypted, ''),
			coalesce(github_refresh_token_encrypted, ''),
			github_access_token_expires_at,
			github_refresh_token_expires_at,
			github_token_updated_at,
			github_last_token_refresh_at
		from users
		where user_id = $1
	`
	if forUpdate {
		query += " for update"
	}

	var (
		accessTokenEncrypted  string
		refreshTokenEncrypted string
		accessTokenExpiresAt  *time.Time
		refreshTokenExpiresAt *time.Time
		tokenUpdatedAt        *time.Time
		lastTokenRefreshAt    *time.Time
	)

	queryRow := r.db.QueryRow
	if tx != nil {
		queryRow = tx.QueryRow
	}

	err := queryRow(ctx, query, userID).Scan(
		&accessTokenEncrypted,
		&refreshTokenEncrypted,
		&accessTokenExpiresAt,
		&refreshTokenExpiresAt,
		&tokenUpdatedAt,
		&lastTokenRefreshAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return authdomain.GitHubTokenBundle{}, platformerrors.ErrNotFound
		}
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("get user github token bundle: %w", err)
	}

	accessToken, err := r.decryptToken(strings.TrimSpace(accessTokenEncrypted))
	if err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("decrypt access token: %w", err)
	}
	refreshToken, err := r.decryptToken(strings.TrimSpace(refreshTokenEncrypted))
	if err != nil {
		return authdomain.GitHubTokenBundle{}, fmt.Errorf("decrypt refresh token: %w", err)
	}

	return authdomain.GitHubTokenBundle{
		AccessToken:           strings.TrimSpace(accessToken),
		RefreshToken:          strings.TrimSpace(refreshToken),
		AccessTokenExpiresAt:  normalizeTimePtr(accessTokenExpiresAt),
		RefreshTokenExpiresAt: normalizeTimePtr(refreshTokenExpiresAt),
		TokenUpdatedAt:        normalizeTimePtr(tokenUpdatedAt),
		LastTokenRefreshAt:    normalizeTimePtr(lastTokenRefreshAt),
	}, nil
}

func (r *UserRepository) encryptToken(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if r.tokenCipher == nil {
		return "", fmt.Errorf("token cipher not configured")
	}
	return r.tokenCipher.Encrypt(trimmed)
}

func (r *UserRepository) decryptToken(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if r.tokenCipher == nil {
		return "", fmt.Errorf("token cipher not configured")
	}
	return r.tokenCipher.Decrypt(trimmed)
}

func normalizeTime(value *time.Time) any {
	if value == nil || value.IsZero() {
		return nil
	}
	return value.UTC()
}

func normalizeTimePtr(value *time.Time) *time.Time {
	if value == nil || value.IsZero() {
		return nil
	}
	normalized := value.UTC()
	return &normalized
}
