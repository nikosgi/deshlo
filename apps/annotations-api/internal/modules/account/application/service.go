package application

import (
	"context"
	"errors"
	"log"
	"strings"

	accountdomain "github.com/deshlo/annotations-api/internal/modules/account/domain"
	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
)

var ErrAuthRequired = accountdomain.ErrAuthRequired
var ErrRepoNotFound = accountdomain.ErrRepoNotFound
var ErrKeyNotFound = accountdomain.ErrKeyNotFound

type Repository interface {
	ListUserProjects(ctx context.Context, ownerUserID string) ([]accountdomain.UserProject, error)
	ListUserAPIKeys(ctx context.Context, ownerUserID string) ([]accountdomain.UserAPIKeyWithProject, error)
	CreateUserAPIKeyForRepo(ctx context.Context, input accountdomain.CreateUserAPIKeyForRepoInput) (accountdomain.CreatedUserAPIKey, accountdomain.UserProject, error)
	DeleteUserAPIKey(ctx context.Context, ownerUserID, keyID string) error
}

type GitHubTokenProvider interface {
	EnsureValidGitHubTokenForUser(ctx context.Context, userID string, forceRefresh bool) (string, error)
}

type GitHubProjectPort interface {
	FetchRepos(ctx context.Context, token string) ([]githubdomain.Repository, error)
	FetchRepoByFullName(ctx context.Context, token, fullName string) (githubdomain.Repository, error)
}

type Service struct {
	repo   Repository
	tokens GitHubTokenProvider
	github GitHubProjectPort
	logger *log.Logger
}

func NewService(repo Repository, tokens GitHubTokenProvider, github GitHubProjectPort, logger *log.Logger) *Service {
	return &Service{
		repo:   repo,
		tokens: tokens,
		github: github,
		logger: logger,
	}
}

func (s *Service) ListProjects(ctx context.Context, userID string) ([]accountdomain.UserProject, error) {
	return s.repo.ListUserProjects(ctx, strings.TrimSpace(userID))
}

func (s *Service) ListKeys(ctx context.Context, userID string) ([]accountdomain.UserAPIKeyWithProject, error) {
	return s.repo.ListUserAPIKeys(ctx, strings.TrimSpace(userID))
}

func (s *Service) DeleteKey(ctx context.Context, userID, keyID string) error {
	err := s.repo.DeleteUserAPIKey(ctx, strings.TrimSpace(userID), strings.TrimSpace(keyID))
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return ErrKeyNotFound
		}
		return err
	}
	return nil
}

func (s *Service) ListGitHubRepos(ctx context.Context, userID string) ([]githubdomain.Repository, error) {
	token, err := s.tokens.EnsureValidGitHubTokenForUser(ctx, strings.TrimSpace(userID), false)
	if err != nil || token == "" {
		return nil, ErrAuthRequired
	}

	repos, err := s.github.FetchRepos(ctx, token)
	if err != nil {
		if errors.Is(err, githubdomain.ErrUnauthorized) {
			refreshedToken, refreshErr := s.tokens.EnsureValidGitHubTokenForUser(ctx, strings.TrimSpace(userID), true)
			if refreshErr != nil || refreshedToken == "" {
				return nil, ErrAuthRequired
			}
			return s.github.FetchRepos(ctx, refreshedToken)
		}
		return nil, err
	}

	return repos, nil
}

func (s *Service) CreateKeyFromRepository(ctx context.Context, userID, repoFullName string) (accountdomain.CreatedUserAPIKey, accountdomain.UserProject, error) {
	trimmedUserID := strings.TrimSpace(userID)
	trimmedRepo := strings.TrimSpace(repoFullName)
	if trimmedRepo == "" || !strings.Contains(trimmedRepo, "/") {
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, ErrRepoNotFound
	}

	token, err := s.tokens.EnsureValidGitHubTokenForUser(ctx, trimmedUserID, false)
	if err != nil || token == "" {
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, ErrAuthRequired
	}

	repo, err := s.github.FetchRepoByFullName(ctx, token, trimmedRepo)
	if err != nil && errors.Is(err, githubdomain.ErrUnauthorized) {
		refreshedToken, refreshErr := s.tokens.EnsureValidGitHubTokenForUser(ctx, trimmedUserID, true)
		if refreshErr != nil {
			return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, ErrAuthRequired
		}
		repo, err = s.github.FetchRepoByFullName(ctx, refreshedToken, trimmedRepo)
	}
	if err != nil {
		if errors.Is(err, githubdomain.ErrUnauthorized) {
			return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, ErrAuthRequired
		}
		if errors.Is(err, githubdomain.ErrNotFound) {
			return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, ErrRepoNotFound
		}
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, err
	}

	createdKey, project, err := s.repo.CreateUserAPIKeyForRepo(ctx, accountdomain.CreateUserAPIKeyForRepoInput{
		OwnerUserID:  trimmedUserID,
		Name:         repo.FullName,
		RepoOwner:    repo.Owner.Login,
		RepoName:     repo.Name,
		RepoFullName: repo.FullName,
		RepoHTMLURL:  repo.HTMLURL,
	})
	if err != nil {
		return accountdomain.CreatedUserAPIKey{}, accountdomain.UserProject{}, err
	}
	return createdKey, project, nil
}
