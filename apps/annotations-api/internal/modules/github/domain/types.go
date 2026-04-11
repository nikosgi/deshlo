package domain

import (
	"errors"
	"time"
)

var ErrUnauthorized = errors.New("github unauthorized")
var ErrNotFound = errors.New("github not found")
var ErrInvalidGrant = errors.New("github invalid grant")
var ErrReauthRequired = errors.New("github reauth required")

const WarningCodeReauthRequired = "GITHUB_REAUTH_REQUIRED"

type OAuthTokenExchange struct {
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresAt  *time.Time
	RefreshTokenExpiresAt *time.Time
}

type UserProfile struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

type UserEmail struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

type RepositoryOwner struct {
	Login string `json:"login"`
}

type RepositoryPermissions struct {
	Admin bool `json:"admin"`
	Push  bool `json:"push"`
	Pull  bool `json:"pull"`
}

type Repository struct {
	ID            int64                 `json:"id"`
	Name          string                `json:"name"`
	FullName      string                `json:"fullName"`
	HTMLURL       string                `json:"htmlUrl"`
	Private       bool                  `json:"private"`
	DefaultBranch string                `json:"defaultBranch"`
	Owner         RepositoryOwner       `json:"owner"`
	Permissions   RepositoryPermissions `json:"permissions"`
}

type CommitMetadata struct {
	CommitSHA   string
	Message     string
	CommittedAt time.Time
	HTMLURL     string
	Branches    []string
	Parents     []string
	FetchedAt   time.Time
}
