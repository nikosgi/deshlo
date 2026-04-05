package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

var errGitHubUnauthorized = errors.New("github unauthorized")
var errGitHubNotFound = errors.New("github not found")

type githubRepoOwner struct {
	Login string `json:"login"`
}

type githubRepoPermissions struct {
	Admin bool `json:"admin"`
	Push  bool `json:"push"`
	Pull  bool `json:"pull"`
}

type githubRepository struct {
	ID            int64                 `json:"id"`
	Name          string                `json:"name"`
	FullName      string                `json:"fullName"`
	HTMLURL       string                `json:"htmlUrl"`
	Private       bool                  `json:"private"`
	DefaultBranch string                `json:"defaultBranch"`
	Owner         githubRepoOwner       `json:"owner"`
	Permissions   githubRepoPermissions `json:"permissions"`
}

type githubRepositoryAPI struct {
	ID            int64                 `json:"id"`
	Name          string                `json:"name"`
	FullName      string                `json:"full_name"`
	HTMLURL       string                `json:"html_url"`
	Private       bool                  `json:"private"`
	DefaultBranch string                `json:"default_branch"`
	Owner         githubRepoOwner       `json:"owner"`
	Permissions   githubRepoPermissions `json:"permissions"`
}

func (s *Server) fetchGitHubRepos(ctx context.Context, token string) ([]githubRepository, error) {
	endpoint := "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
	var reposAPI []githubRepositoryAPI
	if err := s.githubGET(ctx, token, endpoint, &reposAPI); err != nil {
		return nil, err
	}
	repos := make([]githubRepository, 0, len(reposAPI))
	for _, repo := range reposAPI {
		repos = append(repos, mapGitHubRepository(repo))
	}
	return repos, nil
}

func (s *Server) fetchGitHubRepoByFullName(ctx context.Context, token, fullName string) (githubRepository, error) {
	fullName = strings.TrimSpace(fullName)
	if fullName == "" || !strings.Contains(fullName, "/") {
		return githubRepository{}, errGitHubNotFound
	}

	parts := strings.SplitN(fullName, "/", 2)
	owner := strings.TrimSpace(parts[0])
	repoName := strings.TrimSpace(parts[1])
	if owner == "" || repoName == "" {
		return githubRepository{}, errGitHubNotFound
	}

	// GitHub repo endpoint expects /repos/{owner}/{repo}; escaping the slash in fullName causes false 404s.
	endpoint := "https://api.github.com/repos/" + owner + "/" + repoName
	var repoAPI githubRepositoryAPI
	if err := s.githubGET(ctx, token, endpoint, &repoAPI); err != nil {
		return githubRepository{}, err
	}
	return mapGitHubRepository(repoAPI), nil
}

func (s *Server) githubGET(ctx context.Context, token, endpoint string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create github request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("perform github request: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return errGitHubUnauthorized
	case http.StatusNotFound:
		return errGitHubNotFound
	}

	if resp.StatusCode >= 300 {
		return fmt.Errorf("github request failed with status %d", resp.StatusCode)
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode github response: %w", err)
	}
	return nil
}

func mapGitHubRepository(repo githubRepositoryAPI) githubRepository {
	return githubRepository{
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
