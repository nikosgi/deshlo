package domain

import "time"

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

type GitHubTokenBundle struct {
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresAt  *time.Time
	RefreshTokenExpiresAt *time.Time
	TokenUpdatedAt        *time.Time
	LastTokenRefreshAt    *time.Time
}

type UpsertGitHubUserInput struct {
	GitHubID              string
	Email                 string
	Name                  string
	AvatarURL             string
	GitHubAccessToken     string
	GitHubRefreshToken    string
	AccessTokenExpiresAt  *time.Time
	RefreshTokenExpiresAt *time.Time
	LastTokenRefreshAt    *time.Time
}
