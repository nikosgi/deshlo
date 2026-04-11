package application

import (
	"context"

	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
)

type OAuthService interface {
	AuthorizeURL(state string) string
	ExchangeCode(ctx context.Context, code, state string) (githubdomain.OAuthTokenExchange, error)
	ExchangeRefreshToken(ctx context.Context, refreshToken string) (githubdomain.OAuthTokenExchange, error)
	FetchProfile(ctx context.Context, token string) (githubdomain.UserProfile, error)
	FetchPrimaryEmail(ctx context.Context, token string) (string, error)
}

type MetadataService interface {
	FetchRepos(ctx context.Context, token string) ([]githubdomain.Repository, error)
	FetchRepoByFullName(ctx context.Context, token, fullName string) (githubdomain.Repository, error)
	FetchCommitMetadata(
		ctx context.Context,
		token string,
		owner string,
		repo string,
		commitSHAs []string,
	) (map[string]githubdomain.CommitMetadata, error)
}
