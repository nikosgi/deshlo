package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/deshlo/annotations-api/internal/auth"
	"github.com/deshlo/annotations-api/internal/store"
)

type GitHubOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	DashboardURL string
	JWTSecret    string
	JWTTTL       time.Duration
}

type githubAccessTokenResponse struct {
	AccessToken string `json:"access_token"`
	Error       string `json:"error"`
}

type githubUserProfile struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
}

type githubUserEmail struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func (s *Server) handleAuthGitHubStart(w http.ResponseWriter, r *http.Request) {
	state, err := auth.CreateOAuthState(s.oauth.JWTSecret)
	if err != nil {
		s.logger.Printf("create oauth state error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "message": "PROVIDER_ERROR"})
		return
	}

	q := url.Values{}
	q.Set("client_id", s.oauth.ClientID)
	q.Set("redirect_uri", s.oauth.RedirectURL)
	q.Set("scope", "read:user user:email repo read:org")
	q.Set("state", state)

	http.Redirect(w, r, "https://github.com/login/oauth/authorize?"+q.Encode(), http.StatusTemporaryRedirect)
}

func (s *Server) handleAuthGitHubCallback(w http.ResponseWriter, r *http.Request) {
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if state == "" || code == "" {
		http.Redirect(w, r, s.oauth.DashboardURL+"?auth_error=missing_code_or_state", http.StatusTemporaryRedirect)
		return
	}

	if err := auth.ValidateOAuthState(s.oauth.JWTSecret, state, 10*time.Minute); err != nil {
		http.Redirect(w, r, s.oauth.DashboardURL+"?auth_error=invalid_state", http.StatusTemporaryRedirect)
		return
	}

	accessToken, err := s.exchangeGitHubCode(r.Context(), code, state)
	if err != nil {
		s.logger.Printf("exchange github code error: %v", err)
		http.Redirect(w, r, s.oauth.DashboardURL+"?auth_error=token_exchange_failed", http.StatusTemporaryRedirect)
		return
	}

	profile, err := s.fetchGitHubProfile(r.Context(), accessToken)
	if err != nil {
		s.logger.Printf("fetch github profile error: %v", err)
		http.Redirect(w, r, s.oauth.DashboardURL+"?auth_error=profile_fetch_failed", http.StatusTemporaryRedirect)
		return
	}

	email := strings.TrimSpace(profile.Email)
	if email == "" {
		email, _ = s.fetchGitHubPrimaryEmail(r.Context(), accessToken)
	}

	name := strings.TrimSpace(profile.Name)
	if name == "" {
		name = strings.TrimSpace(profile.Login)
	}

	user, err := s.store.UpsertGitHubUser(r.Context(), store.UpsertGitHubUserInput{
		GitHubID:          fmt.Sprintf("%d", profile.ID),
		Email:             email,
		Name:              name,
		AvatarURL:         strings.TrimSpace(profile.AvatarURL),
		GitHubAccessToken: strings.TrimSpace(accessToken),
	})
	if err != nil {
		s.logger.Printf("upsert github user error: %v", err)
		http.Redirect(w, r, s.oauth.DashboardURL+"?auth_error=user_upsert_failed", http.StatusTemporaryRedirect)
		return
	}

	jwtToken, err := auth.CreateUserToken(s.oauth.JWTSecret, user.UserID, s.oauth.JWTTTL)
	if err != nil {
		s.logger.Printf("create jwt token error: %v", err)
		http.Redirect(w, r, s.oauth.DashboardURL+"?auth_error=token_create_failed", http.StatusTemporaryRedirect)
		return
	}

	separator := "?"
	if strings.Contains(s.oauth.DashboardURL, "?") {
		separator = "&"
	}
	http.Redirect(w, r, s.oauth.DashboardURL+separator+"auth_token="+url.QueryEscape(jwtToken), http.StatusTemporaryRedirect)
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) exchangeGitHubCode(ctx context.Context, code string, state string) (string, error) {
	form := url.Values{}
	form.Set("client_id", s.oauth.ClientID)
	form.Set("client_secret", s.oauth.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", s.oauth.RedirectURL)
	form.Set("state", state)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://github.com/login/oauth/access_token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var tokenResp githubAccessTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", err
	}
	if tokenResp.AccessToken == "" {
		if tokenResp.Error != "" {
			return "", fmt.Errorf("github oauth error: %s", tokenResp.Error)
		}
		return "", fmt.Errorf("github oauth access token missing")
	}

	return tokenResp.AccessToken, nil
}

func (s *Server) fetchGitHubProfile(ctx context.Context, token string) (githubUserProfile, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user", nil)
	if err != nil {
		return githubUserProfile{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return githubUserProfile{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return githubUserProfile{}, fmt.Errorf("github profile request failed with status %d", resp.StatusCode)
	}

	var profile githubUserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return githubUserProfile{}, err
	}
	if profile.ID == 0 {
		return githubUserProfile{}, fmt.Errorf("github profile id missing")
	}
	return profile, nil
}

func (s *Server) fetchGitHubPrimaryEmail(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/user/emails", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("github emails request failed with status %d", resp.StatusCode)
	}

	var emails []githubUserEmail
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", err
	}

	for _, email := range emails {
		if email.Primary && email.Verified && strings.TrimSpace(email.Email) != "" {
			return strings.TrimSpace(email.Email), nil
		}
	}
	for _, email := range emails {
		if strings.TrimSpace(email.Email) != "" {
			return strings.TrimSpace(email.Email), nil
		}
	}

	return "", nil
}
