package application

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	authdomain "github.com/deshlo/annotations-api/internal/modules/auth/domain"
	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
	security "github.com/deshlo/annotations-api/internal/platform/security"
)

const githubAccessTokenRefreshBuffer = 60 * time.Second

type OAuthConfig struct {
	DashboardURL string
	JWTSecret    string
	JWTTTL       time.Duration
}

type UserTokenRepository interface {
	UpsertGitHubUser(ctx context.Context, input authdomain.UpsertGitHubUserInput) (authdomain.User, error)
	GetUserByID(ctx context.Context, userID string) (authdomain.User, error)
	GetUserGitHubTokenBundle(ctx context.Context, userID string) (authdomain.GitHubTokenBundle, error)
	WithUserGitHubTokenLock(
		ctx context.Context,
		userID string,
		fn func(current authdomain.GitHubTokenBundle) (authdomain.GitHubTokenBundle, error),
	) (authdomain.GitHubTokenBundle, error)
}

type GitHubOAuthPort interface {
	AuthorizeURL(state string) string
	ExchangeCode(ctx context.Context, code, state string) (githubdomain.OAuthTokenExchange, error)
	ExchangeRefreshToken(ctx context.Context, refreshToken string) (githubdomain.OAuthTokenExchange, error)
	FetchProfile(ctx context.Context, token string) (githubdomain.UserProfile, error)
	FetchPrimaryEmail(ctx context.Context, token string) (string, error)
}

type Service struct {
	repo   UserTokenRepository
	github GitHubOAuthPort
	cfg    OAuthConfig
	logger *log.Logger
}

func NewService(
	repo UserTokenRepository,
	github GitHubOAuthPort,
	cfg OAuthConfig,
	logger *log.Logger,
) *Service {
	return &Service{
		repo:   repo,
		github: github,
		cfg:    cfg,
		logger: logger,
	}
}

func (s *Service) StartAuthorizationURL() (string, error) {
	state, err := authdomain.CreateOAuthState(s.cfg.JWTSecret)
	if err != nil {
		return "", err
	}
	return s.github.AuthorizeURL(state), nil
}

func (s *Service) CompleteGitHubCallback(ctx context.Context, state, code string) string {
	state = strings.TrimSpace(state)
	code = strings.TrimSpace(code)
	if state == "" || code == "" {
		return s.appendAuthError("missing_code_or_state")
	}

	if err := authdomain.ValidateOAuthState(s.cfg.JWTSecret, state, 10*time.Minute); err != nil {
		return s.appendAuthError("invalid_state")
	}

	tokenExchange, err := s.github.ExchangeCode(ctx, code, state)
	if err != nil {
		s.logger.Printf("exchange github code error: %v", err)
		return s.appendAuthError("token_exchange_failed")
	}

	profile, err := s.github.FetchProfile(ctx, tokenExchange.AccessToken)
	if err != nil {
		s.logger.Printf("fetch github profile error: %v", err)
		return s.appendAuthError("profile_fetch_failed")
	}

	email := strings.TrimSpace(profile.Email)
	if email == "" {
		email, _ = s.github.FetchPrimaryEmail(ctx, tokenExchange.AccessToken)
	}

	name := strings.TrimSpace(profile.Name)
	if name == "" {
		name = strings.TrimSpace(profile.Login)
	}

	user, err := s.repo.UpsertGitHubUser(ctx, authdomain.UpsertGitHubUserInput{
		GitHubID:              fmt.Sprintf("%d", profile.ID),
		Email:                 email,
		Name:                  name,
		AvatarURL:             strings.TrimSpace(profile.AvatarURL),
		GitHubAccessToken:     strings.TrimSpace(tokenExchange.AccessToken),
		GitHubRefreshToken:    strings.TrimSpace(tokenExchange.RefreshToken),
		AccessTokenExpiresAt:  tokenExchange.AccessTokenExpiresAt,
		RefreshTokenExpiresAt: tokenExchange.RefreshTokenExpiresAt,
	})
	if err != nil {
		s.logger.Printf("upsert github user error: %v", err)
		return s.appendAuthError("user_upsert_failed")
	}

	jwtToken, err := security.CreateUserToken(s.cfg.JWTSecret, user.UserID, s.cfg.JWTTTL)
	if err != nil {
		s.logger.Printf("create jwt token error: %v", err)
		return s.appendAuthError("token_create_failed")
	}

	separator := "?"
	if strings.Contains(s.cfg.DashboardURL, "?") {
		separator = "&"
	}
	return s.cfg.DashboardURL + separator + "auth_token=" + url.QueryEscape(jwtToken)
}

func (s *Service) appendAuthError(code string) string {
	separator := "?"
	if strings.Contains(s.cfg.DashboardURL, "?") {
		separator = "&"
	}
	return s.cfg.DashboardURL + separator + "auth_error=" + url.QueryEscape(strings.TrimSpace(code))
}

func (s *Service) GetUserByID(ctx context.Context, userID string) (authdomain.User, error) {
	return s.repo.GetUserByID(ctx, strings.TrimSpace(userID))
}

func (s *Service) EnsureValidGitHubTokenForUser(ctx context.Context, userID string, forceRefresh bool) (string, error) {
	trimmedUserID := strings.TrimSpace(userID)
	if trimmedUserID == "" {
		return "", githubdomain.ErrReauthRequired
	}

	bundle, err := s.repo.GetUserGitHubTokenBundle(ctx, trimmedUserID)
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return "", githubdomain.ErrReauthRequired
		}
		return "", err
	}

	if forceRefresh || needsGitHubTokenRefresh(bundle, time.Now().UTC()) {
		bundle, err = s.refreshGitHubTokenBundleWithLock(ctx, trimmedUserID, forceRefresh)
		if err != nil {
			return "", err
		}
	}

	accessToken := strings.TrimSpace(bundle.AccessToken)
	if accessToken == "" {
		return "", githubdomain.ErrReauthRequired
	}
	return accessToken, nil
}

func (s *Service) refreshGitHubTokenBundleWithLock(
	ctx context.Context,
	userID string,
	forceRefresh bool,
) (authdomain.GitHubTokenBundle, error) {
	refreshedBundle, err := s.repo.WithUserGitHubTokenLock(
		ctx,
		userID,
		func(current authdomain.GitHubTokenBundle) (authdomain.GitHubTokenBundle, error) {
			now := time.Now().UTC()
			if !forceRefresh && !needsGitHubTokenRefresh(current, now) {
				return current, nil
			}

			if refreshExpired(current, now) {
				return authdomain.GitHubTokenBundle{}, githubdomain.ErrReauthRequired
			}

			refreshToken := strings.TrimSpace(current.RefreshToken)
			if refreshToken == "" {
				if !forceRefresh && strings.TrimSpace(current.AccessToken) != "" && current.AccessTokenExpiresAt == nil {
					return current, nil
				}
				return authdomain.GitHubTokenBundle{}, githubdomain.ErrReauthRequired
			}

			exchanged, err := s.github.ExchangeRefreshToken(ctx, refreshToken)
			if err != nil {
				if errors.Is(err, githubdomain.ErrReauthRequired) || errors.Is(err, githubdomain.ErrUnauthorized) {
					return authdomain.GitHubTokenBundle{}, githubdomain.ErrReauthRequired
				}
				if errors.Is(err, githubdomain.ErrInvalidGrant) {
					return authdomain.GitHubTokenBundle{}, githubdomain.ErrReauthRequired
				}
				return authdomain.GitHubTokenBundle{}, err
			}

			updated := current
			updated.AccessToken = strings.TrimSpace(exchanged.AccessToken)
			if strings.TrimSpace(exchanged.RefreshToken) != "" {
				updated.RefreshToken = strings.TrimSpace(exchanged.RefreshToken)
			}
			updated.AccessTokenExpiresAt = cloneTimePtr(exchanged.AccessTokenExpiresAt)
			if exchanged.RefreshTokenExpiresAt != nil {
				updated.RefreshTokenExpiresAt = cloneTimePtr(exchanged.RefreshTokenExpiresAt)
			}
			updatedAt := now.UTC()
			updated.TokenUpdatedAt = &updatedAt
			lastRefreshAt := now.UTC()
			updated.LastTokenRefreshAt = &lastRefreshAt

			if strings.TrimSpace(updated.AccessToken) == "" {
				return authdomain.GitHubTokenBundle{}, fmt.Errorf("refreshed github token is empty")
			}

			return updated, nil
		},
	)
	if err != nil {
		return authdomain.GitHubTokenBundle{}, err
	}

	return refreshedBundle, nil
}

func needsGitHubTokenRefresh(bundle authdomain.GitHubTokenBundle, now time.Time) bool {
	if strings.TrimSpace(bundle.AccessToken) == "" {
		return true
	}
	if bundle.AccessTokenExpiresAt == nil {
		return false
	}
	return now.Add(githubAccessTokenRefreshBuffer).After(bundle.AccessTokenExpiresAt.UTC())
}

func refreshExpired(bundle authdomain.GitHubTokenBundle, now time.Time) bool {
	if bundle.RefreshTokenExpiresAt == nil {
		return false
	}
	return now.After(bundle.RefreshTokenExpiresAt.UTC())
}

func cloneTimePtr(value *time.Time) *time.Time {
	if value == nil || value.IsZero() {
		return nil
	}
	normalized := value.UTC()
	return &normalized
}
