package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type User struct {
	UserID               string    `json:"userId"`
	GitHubID             string    `json:"githubId"`
	Email                string    `json:"email"`
	Name                 string    `json:"name"`
	AvatarURL            string    `json:"avatarUrl"`
	CreatedAt            time.Time `json:"createdAt"`
	GitHubAccessToken    string    `json:"-"`
	GitHubTokenUpdatedAt time.Time `json:"-"`
}

type UpsertGitHubUserInput struct {
	GitHubID          string
	Email             string
	Name              string
	AvatarURL         string
	GitHubAccessToken string
}

func (s *Store) UpsertGitHubUser(ctx context.Context, input UpsertGitHubUserInput) (User, error) {
	githubID := strings.TrimSpace(input.GitHubID)
	if githubID == "" {
		return User{}, fmt.Errorf("github id is required")
	}

	now := time.Now().UTC()
	userID := randomID("usr")

	var user User
	err := s.db.QueryRow(ctx, `
		insert into users (
			user_id, github_id, email, name, avatar_url, github_access_token, github_token_updated_at, created_at
		) values ($1, $2, $3, $4, $5, $6, $7, $8)
		on conflict (github_id)
		do update set
			email = excluded.email,
			name = excluded.name,
			avatar_url = excluded.avatar_url,
			github_access_token = excluded.github_access_token,
			github_token_updated_at = excluded.github_token_updated_at
		returning user_id, github_id, coalesce(email, ''), coalesce(name, ''), coalesce(avatar_url, ''), created_at
	`, userID, githubID, nullIfEmpty(strings.TrimSpace(input.Email)), nullIfEmpty(strings.TrimSpace(input.Name)), nullIfEmpty(strings.TrimSpace(input.AvatarURL)), nullIfEmpty(strings.TrimSpace(input.GitHubAccessToken)), now, now).
		Scan(&user.UserID, &user.GitHubID, &user.Email, &user.Name, &user.AvatarURL, &user.CreatedAt)
	if err != nil {
		return User{}, fmt.Errorf("upsert github user: %w", err)
	}

	return user, nil
}

func (s *Store) GetUserByID(ctx context.Context, userID string) (User, error) {
	var user User
	err := s.db.QueryRow(ctx, `
		select user_id, github_id, coalesce(email, ''), coalesce(name, ''), coalesce(avatar_url, ''), created_at
		from users
		where user_id = $1
	`, strings.TrimSpace(userID)).Scan(&user.UserID, &user.GitHubID, &user.Email, &user.Name, &user.AvatarURL, &user.CreatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("get user by id: %w", err)
	}
	return user, nil
}

func (s *Store) GetUserGitHubAccessToken(ctx context.Context, userID string) (string, error) {
	var token string
	err := s.db.QueryRow(ctx, `
		select coalesce(github_access_token, '')
		from users
		where user_id = $1
	`, strings.TrimSpace(userID)).Scan(&token)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("get user github access token: %w", err)
	}
	return strings.TrimSpace(token), nil
}
