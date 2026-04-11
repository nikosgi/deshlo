package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
)

const (
	githubAPIBaseURL             = "https://api.github.com"
	githubOAuthTokenURL          = "https://github.com/login/oauth/access_token"
	githubGraphQLEndpoint        = "https://api.github.com/graphql"
	graphqlCommitBatchSize       = 25
	githubBranchesFetchLimit     = 10
	githubBranchCommitsFetchSize = 200
)

var gitSHARegex = regexp.MustCompile(`^[0-9a-fA-F]{7,64}$`)

type Client struct {
	httpClient   *http.Client
	clientID     string
	clientSecret string
	redirectURL  string
}

type Option func(*Client)

func WithHTTPClient(httpClient *http.Client) Option {
	return func(c *Client) {
		if httpClient != nil {
			c.httpClient = httpClient
		}
	}
}

func NewClient(clientID, clientSecret, redirectURL string, opts ...Option) *Client {
	client := &Client{
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		clientID:     strings.TrimSpace(clientID),
		clientSecret: strings.TrimSpace(clientSecret),
		redirectURL:  strings.TrimSpace(redirectURL),
	}
	for _, option := range opts {
		if option != nil {
			option(client)
		}
	}
	return client
}

func (c *Client) AuthorizeURL(state string) string {
	q := url.Values{}
	q.Set("client_id", c.clientID)
	q.Set("redirect_uri", c.redirectURL)
	q.Set("scope", "read:user user:email repo read:org")
	q.Set("state", state)
	return "https://github.com/login/oauth/authorize?" + q.Encode()
}

type githubAccessTokenResponse struct {
	AccessToken           string          `json:"access_token"`
	TokenType             string          `json:"token_type"`
	ExpiresIn             json.RawMessage `json:"expires_in"`
	RefreshToken          string          `json:"refresh_token"`
	RefreshTokenExpiresIn json.RawMessage `json:"refresh_token_expires_in"`
	Error                 string          `json:"error"`
	ErrorDescription      string          `json:"error_description"`
}

func (c *Client) ExchangeCode(ctx context.Context, code, state string) (githubdomain.OAuthTokenExchange, error) {
	form := url.Values{}
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.clientSecret)
	form.Set("code", strings.TrimSpace(code))
	form.Set("redirect_uri", c.redirectURL)
	form.Set("state", strings.TrimSpace(state))

	payload, err := c.exchangeTokenForm(ctx, form)
	if err != nil {
		return githubdomain.OAuthTokenExchange{}, err
	}
	return parseGitHubTokenExchange(payload, time.Now().UTC())
}

func (c *Client) ExchangeRefreshToken(ctx context.Context, refreshToken string) (githubdomain.OAuthTokenExchange, error) {
	trimmed := strings.TrimSpace(refreshToken)
	if trimmed == "" {
		return githubdomain.OAuthTokenExchange{}, githubdomain.ErrReauthRequired
	}

	form := url.Values{}
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.clientSecret)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", trimmed)

	payload, err := c.exchangeTokenForm(ctx, form)
	if err != nil {
		return githubdomain.OAuthTokenExchange{}, err
	}
	return parseGitHubTokenExchange(payload, time.Now().UTC())
}

func (c *Client) exchangeTokenForm(ctx context.Context, form url.Values) (githubAccessTokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, githubOAuthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return githubAccessTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return githubAccessTokenResponse{}, err
	}
	defer resp.Body.Close()

	var tokenResp githubAccessTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return githubAccessTokenResponse{}, err
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return githubAccessTokenResponse{}, githubdomain.ErrReauthRequired
	}
	return tokenResp, nil
}

func parseGitHubTokenExchange(payload githubAccessTokenResponse, now time.Time) (githubdomain.OAuthTokenExchange, error) {
	if payload.Error != "" {
		if payload.Error == "invalid_grant" {
			return githubdomain.OAuthTokenExchange{}, githubdomain.ErrInvalidGrant
		}
		if payload.ErrorDescription != "" {
			return githubdomain.OAuthTokenExchange{}, fmt.Errorf("github oauth error: %s (%s)", payload.Error, payload.ErrorDescription)
		}
		return githubdomain.OAuthTokenExchange{}, fmt.Errorf("github oauth error: %s", payload.Error)
	}

	accessToken := strings.TrimSpace(payload.AccessToken)
	if accessToken == "" {
		return githubdomain.OAuthTokenExchange{}, fmt.Errorf("github oauth access token missing")
	}

	result := githubdomain.OAuthTokenExchange{
		AccessToken:  accessToken,
		RefreshToken: strings.TrimSpace(payload.RefreshToken),
	}

	if seconds, err := parseTokenTTLSeconds(payload.ExpiresIn); err != nil {
		return githubdomain.OAuthTokenExchange{}, fmt.Errorf("parse github expires_in: %w", err)
	} else if seconds > 0 {
		expiresAt := now.Add(time.Duration(seconds) * time.Second).UTC()
		result.AccessTokenExpiresAt = &expiresAt
	}

	if seconds, err := parseTokenTTLSeconds(payload.RefreshTokenExpiresIn); err != nil {
		return githubdomain.OAuthTokenExchange{}, fmt.Errorf("parse github refresh_token_expires_in: %w", err)
	} else if seconds > 0 {
		expiresAt := now.Add(time.Duration(seconds) * time.Second).UTC()
		result.RefreshTokenExpiresAt = &expiresAt
	}

	return result, nil
}

func parseTokenTTLSeconds(raw json.RawMessage) (int64, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return 0, nil
	}

	if len(trimmed) >= 2 && strings.HasPrefix(trimmed, "\"") && strings.HasSuffix(trimmed, "\"") {
		unquoted, err := strconv.Unquote(trimmed)
		if err != nil {
			return 0, err
		}
		trimmed = strings.TrimSpace(unquoted)
		if trimmed == "" {
			return 0, nil
		}
	}

	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0, err
	}
	if parsed < 0 {
		return 0, fmt.Errorf("negative ttl")
	}
	return parsed, nil
}

func (c *Client) FetchProfile(ctx context.Context, token string) (githubdomain.UserProfile, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPIBaseURL+"/user", nil)
	if err != nil {
		return githubdomain.UserProfile{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return githubdomain.UserProfile{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return githubdomain.UserProfile{}, githubdomain.ErrUnauthorized
		}
		return githubdomain.UserProfile{}, fmt.Errorf("github profile request failed with status %d", resp.StatusCode)
	}

	var profile githubdomain.UserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return githubdomain.UserProfile{}, err
	}
	if profile.ID == 0 {
		return githubdomain.UserProfile{}, fmt.Errorf("github profile id missing")
	}
	return profile, nil
}

func (c *Client) FetchPrimaryEmail(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPIBaseURL+"/user/emails", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return "", githubdomain.ErrUnauthorized
		}
		return "", fmt.Errorf("github emails request failed with status %d", resp.StatusCode)
	}

	var emails []githubdomain.UserEmail
	if err := json.NewDecoder(resp.Body).Decode(&emails); err != nil {
		return "", err
	}

	for _, email := range emails {
		if email.Primary && email.Verified && strings.TrimSpace(email.Email) != "" {
			return strings.TrimSpace(email.Email), nil
		}
	}
	for _, email := range emails {
		if email.Primary && strings.TrimSpace(email.Email) != "" {
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

type repositoryAPI struct {
	ID            int64                              `json:"id"`
	Name          string                             `json:"name"`
	FullName      string                             `json:"full_name"`
	HTMLURL       string                             `json:"html_url"`
	Private       bool                               `json:"private"`
	DefaultBranch string                             `json:"default_branch"`
	Owner         githubdomain.RepositoryOwner       `json:"owner"`
	Permissions   githubdomain.RepositoryPermissions `json:"permissions"`
}

func (c *Client) FetchRepos(ctx context.Context, token string) ([]githubdomain.Repository, error) {
	endpoint := githubAPIBaseURL + "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
	var reposAPI []repositoryAPI
	if err := c.githubGET(ctx, token, endpoint, &reposAPI); err != nil {
		return nil, err
	}
	result := make([]githubdomain.Repository, 0, len(reposAPI))
	for _, repo := range reposAPI {
		result = append(result, mapRepository(repo))
	}
	return result, nil
}

func (c *Client) FetchRepoByFullName(ctx context.Context, token, fullName string) (githubdomain.Repository, error) {
	trimmed := strings.TrimSpace(fullName)
	if trimmed == "" || !strings.Contains(trimmed, "/") {
		return githubdomain.Repository{}, githubdomain.ErrNotFound
	}
	parts := strings.SplitN(trimmed, "/", 2)
	owner := strings.TrimSpace(parts[0])
	repoName := strings.TrimSpace(parts[1])
	if owner == "" || repoName == "" {
		return githubdomain.Repository{}, githubdomain.ErrNotFound
	}

	endpoint := githubAPIBaseURL + "/repos/" + owner + "/" + repoName
	var repo repositoryAPI
	if err := c.githubGET(ctx, token, endpoint, &repo); err != nil {
		return githubdomain.Repository{}, err
	}
	return mapRepository(repo), nil
}

func mapRepository(repo repositoryAPI) githubdomain.Repository {
	return githubdomain.Repository{
		ID:            repo.ID,
		Name:          repo.Name,
		FullName:      repo.FullName,
		HTMLURL:       repo.HTMLURL,
		Private:       repo.Private,
		DefaultBranch: repo.DefaultBranch,
		Owner:         repo.Owner,
		Permissions:   repo.Permissions,
	}
}

func (c *Client) githubGET(ctx context.Context, token, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create github request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("perform github request: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return githubdomain.ErrUnauthorized
	case http.StatusNotFound:
		return githubdomain.ErrNotFound
	}

	if resp.StatusCode >= 300 {
		return fmt.Errorf("github request failed with status %d", resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode github response: %w", err)
	}
	return nil
}

type graphQLCommitNode struct {
	OID             string `json:"oid"`
	MessageHeadline string `json:"messageHeadline"`
	CommittedDate   string `json:"committedDate"`
	URL             string `json:"url"`
	Parents         struct {
		Nodes []struct {
			OID string `json:"oid"`
		} `json:"nodes"`
	} `json:"parents"`
}

type graphQLResponse struct {
	Data struct {
		Repository map[string]graphQLCommitNode `json:"repository"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type branch struct {
	Name string `json:"name"`
}

type restCommit struct {
	SHA     string `json:"sha"`
	HTMLURL string `json:"html_url"`
	Commit  struct {
		Message   string `json:"message"`
		Committer struct {
			Date time.Time `json:"date"`
		} `json:"committer"`
		Author struct {
			Date time.Time `json:"date"`
		} `json:"author"`
	} `json:"commit"`
	Parents []struct {
		SHA string `json:"sha"`
	} `json:"parents"`
}

func (c *Client) FetchCommitMetadata(
	ctx context.Context,
	token string,
	owner string,
	repo string,
	commitSHAs []string,
) (map[string]githubdomain.CommitMetadata, error) {
	normalized := normalizeUniqueCommitSHAs(commitSHAs)
	if len(normalized) == 0 {
		return map[string]githubdomain.CommitMetadata{}, nil
	}

	result := make(map[string]githubdomain.CommitMetadata, len(normalized))
	branchMembership, err := c.fetchBranchMembershipByCommitSHA(ctx, token, owner, repo, normalized)
	if err != nil {
		return nil, err
	}

	graphQLErr := error(nil)
	for _, chunk := range chunkCommitSHAs(normalized, graphqlCommitBatchSize) {
		entries, err := c.fetchCommitMetadataGraphQLBatch(ctx, token, owner, repo, chunk)
		if err != nil {
			graphQLErr = err
			break
		}
		for key, entry := range entries {
			result[key] = entry
		}
	}

	restUnauthorized := false
	for _, sha := range normalized {
		entry, exists := resolveCommit(sha, result)
		if !exists {
			restEntry, err := c.fetchCommitMetadataREST(ctx, token, owner, repo, sha)
			if err != nil {
				if err == githubdomain.ErrUnauthorized {
					restUnauthorized = true
				}
				continue
			}
			entry = restEntry
		}

		entry.Branches = branchMembership[sha]
		entry.FetchedAt = time.Now().UTC()
		result[sha] = entry
		result[entry.CommitSHA] = entry
	}

	for _, sha := range normalized {
		entry, exists := resolveCommit(sha, result)
		if !exists {
			continue
		}
		sort.Strings(entry.Branches)
		result[sha] = entry
		result[entry.CommitSHA] = entry
	}

	trimmed := make(map[string]githubdomain.CommitMetadata, len(normalized))
	for _, sha := range normalized {
		entry, exists := resolveCommit(sha, result)
		if !exists {
			continue
		}
		trimmed[entry.CommitSHA] = entry
	}

	if len(trimmed) == 0 && ((graphQLErr != nil && graphQLErr == githubdomain.ErrUnauthorized) || restUnauthorized) {
		return nil, githubdomain.ErrUnauthorized
	}

	return trimmed, nil
}

func normalizeUniqueCommitSHAs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		sha := strings.TrimSpace(value)
		if sha == "" || !gitSHARegex.MatchString(sha) {
			continue
		}
		if _, exists := seen[sha]; exists {
			continue
		}
		seen[sha] = struct{}{}
		result = append(result, sha)
	}
	return result
}

func chunkCommitSHAs(values []string, size int) [][]string {
	if size <= 0 {
		size = graphqlCommitBatchSize
	}
	chunks := make([][]string, 0, (len(values)+size-1)/size)
	for start := 0; start < len(values); start += size {
		end := start + size
		if end > len(values) {
			end = len(values)
		}
		chunks = append(chunks, values[start:end])
	}
	return chunks
}

func buildCommitMetadataGraphQLQuery(owner, repo string, shas []string) string {
	var builder strings.Builder
	builder.WriteString("query { repository(owner:")
	builder.WriteString(fmt.Sprintf("%q", owner))
	builder.WriteString(", name:")
	builder.WriteString(fmt.Sprintf("%q", repo))
	builder.WriteString(") {")
	for index, sha := range shas {
		builder.WriteString(fmt.Sprintf(`
			c%d: object(expression: %q) {
				... on Commit {
					oid
					messageHeadline
					committedDate
					url
					parents(first: 6) {
						nodes { oid }
					}
				}
			}
		`, index, sha))
	}
	builder.WriteString("} }")
	return builder.String()
}

func (c *Client) fetchCommitMetadataGraphQLBatch(
	ctx context.Context,
	token,
	owner,
	repo string,
	shas []string,
) (map[string]githubdomain.CommitMetadata, error) {
	query := buildCommitMetadataGraphQLQuery(owner, repo, shas)
	payload := map[string]any{"query": query}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal graphql payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, githubGraphQLEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create graphql request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("perform graphql request: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return nil, githubdomain.ErrUnauthorized
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("graphql request failed with status %d", resp.StatusCode)
	}

	var parsed graphQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode graphql response: %w", err)
	}
	if len(parsed.Errors) > 0 {
		return nil, fmt.Errorf("graphql response error: %s", parsed.Errors[0].Message)
	}

	entries := make(map[string]githubdomain.CommitMetadata, len(shas))
	for index, requestedSHA := range shas {
		node, exists := parsed.Data.Repository[fmt.Sprintf("c%d", index)]
		if !exists || strings.TrimSpace(node.OID) == "" {
			continue
		}

		entry := githubdomain.CommitMetadata{
			CommitSHA: strings.TrimSpace(node.OID),
			Message:   strings.TrimSpace(node.MessageHeadline),
			HTMLURL:   strings.TrimSpace(node.URL),
			Branches:  []string{},
			Parents:   []string{},
			FetchedAt: time.Now().UTC(),
		}
		if parsedTime, err := time.Parse(time.RFC3339, strings.TrimSpace(node.CommittedDate)); err == nil {
			entry.CommittedAt = parsedTime.UTC()
		}
		for _, parent := range node.Parents.Nodes {
			parentSHA := strings.TrimSpace(parent.OID)
			if parentSHA != "" {
				entry.Parents = append(entry.Parents, parentSHA)
			}
		}
		entries[requestedSHA] = entry
		entries[entry.CommitSHA] = entry
	}

	return entries, nil
}

func (c *Client) fetchCommitMetadataREST(
	ctx context.Context,
	token,
	owner,
	repo,
	sha string,
) (githubdomain.CommitMetadata, error) {
	var commit restCommit
	endpoint := fmt.Sprintf("%s/repos/%s/%s/commits/%s", githubAPIBaseURL, owner, repo, sha)
	if err := c.githubGET(ctx, token, endpoint, &commit); err != nil {
		return githubdomain.CommitMetadata{}, err
	}

	entry := githubdomain.CommitMetadata{
		CommitSHA: strings.TrimSpace(commit.SHA),
		Message:   strings.TrimSpace(strings.Split(strings.TrimSpace(commit.Commit.Message), "\n")[0]),
		HTMLURL:   strings.TrimSpace(commit.HTMLURL),
		Branches:  []string{},
		Parents:   []string{},
		FetchedAt: time.Now().UTC(),
	}
	if !commit.Commit.Committer.Date.IsZero() {
		entry.CommittedAt = commit.Commit.Committer.Date.UTC()
	} else if !commit.Commit.Author.Date.IsZero() {
		entry.CommittedAt = commit.Commit.Author.Date.UTC()
	}
	for _, parent := range commit.Parents {
		parentSHA := strings.TrimSpace(parent.SHA)
		if parentSHA != "" {
			entry.Parents = append(entry.Parents, parentSHA)
		}
	}
	return entry, nil
}

func (c *Client) fetchBranchMembershipByCommitSHA(
	ctx context.Context,
	token,
	owner,
	repo string,
	targetSHAs []string,
) (map[string][]string, error) {
	membership := make(map[string][]string, len(targetSHAs))
	if len(targetSHAs) == 0 {
		return membership, nil
	}

	var branches []branch
	branchesEndpoint := fmt.Sprintf(
		"%s/repos/%s/%s/branches?per_page=%d",
		githubAPIBaseURL,
		owner,
		repo,
		githubBranchesFetchLimit,
	)
	if err := c.githubGET(ctx, token, branchesEndpoint, &branches); err != nil {
		return nil, err
	}

	for _, branch := range branches {
		branchName := strings.TrimSpace(branch.Name)
		if branchName == "" {
			continue
		}

		var commits []restCommit
		commitsEndpoint := fmt.Sprintf(
			"%s/repos/%s/%s/commits?sha=%s&per_page=%d",
			githubAPIBaseURL,
			owner,
			repo,
			branchName,
			githubBranchCommitsFetchSize,
		)
		if err := c.githubGET(ctx, token, commitsEndpoint, &commits); err != nil {
			if err == githubdomain.ErrUnauthorized {
				return nil, err
			}
			continue
		}

		for _, commit := range commits {
			sha := strings.TrimSpace(commit.SHA)
			if sha == "" {
				continue
			}
			matched := matchCommitSHA(targetSHAs, sha)
			if matched == "" {
				continue
			}
			membership[matched] = appendUnique(membership[matched], branchName)
			membership[sha] = appendUnique(membership[sha], branchName)
		}
	}
	return membership, nil
}

func resolveCommit(
	sha string,
	cached map[string]githubdomain.CommitMetadata,
) (githubdomain.CommitMetadata, bool) {
	if entry, exists := cached[sha]; exists {
		return entry, true
	}
	for key, entry := range cached {
		if strings.HasPrefix(key, sha) || strings.HasPrefix(sha, key) {
			return entry, true
		}
	}
	return githubdomain.CommitMetadata{}, false
}

func matchCommitSHA(targets []string, value string) string {
	for _, target := range targets {
		if target == value || strings.HasPrefix(target, value) || strings.HasPrefix(value, target) {
			return target
		}
	}
	return ""
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
