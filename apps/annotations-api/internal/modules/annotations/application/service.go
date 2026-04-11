package application

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	accountdomain "github.com/deshlo/annotations-api/internal/modules/account/domain"
	annotationsdomain "github.com/deshlo/annotations-api/internal/modules/annotations/domain"
	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
)

const commitMetadataCacheTTL = 6 * time.Hour

var ErrThreadNotFound = annotationsdomain.ErrThreadNotFound

type Repository interface {
	ListThreads(ctx context.Context, input annotationsdomain.ListThreadsInput) ([]annotationsdomain.Thread, error)
	CreateThread(ctx context.Context, input annotationsdomain.CreateThreadInput) (annotationsdomain.Thread, error)
	AddReply(ctx context.Context, input annotationsdomain.ReplyInput) (annotationsdomain.Thread, error)
	SetThreadStatus(ctx context.Context, projectID, threadID string, status annotationsdomain.ThreadStatus) (annotationsdomain.Thread, error)
	MoveThreadAnchor(ctx context.Context, input annotationsdomain.MoveThreadAnchorInput) (annotationsdomain.Thread, error)
	DeleteThread(ctx context.Context, input annotationsdomain.DeleteThreadInput) error
	ListCommitHistoryStats(ctx context.Context, projectID string, pageKey string, environment string) ([]annotationsdomain.CommitHistoryEntry, error)
	GetCommitMetadataCache(ctx context.Context, projectID string, commitSHAs []string) (map[string]annotationsdomain.CommitMetadataCacheEntry, error)
	UpsertCommitMetadataCache(ctx context.Context, projectID string, entries []annotationsdomain.CommitMetadataCacheEntry) error
}

type TokenProvider interface {
	EnsureValidGitHubTokenForUser(ctx context.Context, userID string, forceRefresh bool) (string, error)
}

type GitHubMetadataPort interface {
	FetchCommitMetadata(
		ctx context.Context,
		token string,
		owner string,
		repo string,
		commitSHAs []string,
	) (map[string]githubdomain.CommitMetadata, error)
}

type Service struct {
	repo   Repository
	tokens TokenProvider
	github GitHubMetadataPort
	logger *log.Logger
}

func NewService(repo Repository, tokens TokenProvider, github GitHubMetadataPort, logger *log.Logger) *Service {
	return &Service{repo: repo, tokens: tokens, github: github, logger: logger}
}

func (s *Service) ListThreads(ctx context.Context, input annotationsdomain.ListThreadsInput) ([]annotationsdomain.Thread, error) {
	return s.repo.ListThreads(ctx, input)
}

func (s *Service) CreateThread(ctx context.Context, input annotationsdomain.CreateThreadInput) (annotationsdomain.Thread, error) {
	return s.repo.CreateThread(ctx, input)
}

func (s *Service) ReplyThread(ctx context.Context, input annotationsdomain.ReplyInput) (annotationsdomain.Thread, error) {
	thread, err := s.repo.AddReply(ctx, input)
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return annotationsdomain.Thread{}, ErrThreadNotFound
		}
		return annotationsdomain.Thread{}, err
	}
	return thread, nil
}

func (s *Service) ResolveThread(ctx context.Context, projectID, threadID string) (annotationsdomain.Thread, error) {
	thread, err := s.repo.SetThreadStatus(ctx, strings.TrimSpace(projectID), strings.TrimSpace(threadID), annotationsdomain.ThreadStatusResolved)
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return annotationsdomain.Thread{}, ErrThreadNotFound
		}
		return annotationsdomain.Thread{}, err
	}
	return thread, nil
}

func (s *Service) ReopenThread(ctx context.Context, projectID, threadID string) (annotationsdomain.Thread, error) {
	thread, err := s.repo.SetThreadStatus(ctx, strings.TrimSpace(projectID), strings.TrimSpace(threadID), annotationsdomain.ThreadStatusOpen)
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return annotationsdomain.Thread{}, ErrThreadNotFound
		}
		return annotationsdomain.Thread{}, err
	}
	return thread, nil
}

func (s *Service) MoveThreadAnchor(ctx context.Context, input annotationsdomain.MoveThreadAnchorInput) (annotationsdomain.Thread, error) {
	thread, err := s.repo.MoveThreadAnchor(ctx, input)
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return annotationsdomain.Thread{}, ErrThreadNotFound
		}
		return annotationsdomain.Thread{}, err
	}
	return thread, nil
}

func (s *Service) DeleteThread(ctx context.Context, input annotationsdomain.DeleteThreadInput) error {
	err := s.repo.DeleteThread(ctx, input)
	if err != nil {
		if errors.Is(err, platformerrors.ErrNotFound) {
			return ErrThreadNotFound
		}
		return err
	}
	return nil
}

type CommitHistoryResult struct {
	Commits     []annotationsdomain.CommitHistoryEntry
	WarningCode string
}

func (s *Service) ListCommitHistory(
	ctx context.Context,
	project accountdomain.Project,
	pageKey string,
	environment string,
) (CommitHistoryResult, error) {
	stats, err := s.repo.ListCommitHistoryStats(ctx, project.ProjectID, pageKey, environment)
	if err != nil {
		return CommitHistoryResult{}, err
	}
	if len(stats) == 0 {
		return CommitHistoryResult{Commits: []annotationsdomain.CommitHistoryEntry{}}, nil
	}

	commitSHAs := make([]string, 0, len(stats))
	for _, entry := range stats {
		commitSHAs = append(commitSHAs, entry.CommitSHA)
	}

	cached, err := s.repo.GetCommitMetadataCache(ctx, project.ProjectID, commitSHAs)
	if err != nil {
		return CommitHistoryResult{}, err
	}

	now := time.Now().UTC()
	missing := make([]string, 0)
	for _, sha := range commitSHAs {
		meta, exists := resolveCachedCommit(sha, cached)
		if !exists || now.Sub(meta.FetchedAt) > commitMetadataCacheTTL {
			missing = append(missing, sha)
		}
	}

	warningCode := ""
	if len(missing) > 0 && project.RepoOwner != "" && project.RepoName != "" {
		token, tokenErr := s.tokens.EnsureValidGitHubTokenForUser(ctx, project.OwnerUserID, false)
		if tokenErr != nil {
			if errors.Is(tokenErr, githubdomain.ErrReauthRequired) {
				warningCode = githubdomain.WarningCodeReauthRequired
			} else {
				s.logger.Printf("ensure github token for commit metadata error: %v", tokenErr)
			}
		} else {
			fresh, fetchErr := s.github.FetchCommitMetadata(ctx, token, project.RepoOwner, project.RepoName, missing)
			if fetchErr != nil && errors.Is(fetchErr, githubdomain.ErrUnauthorized) {
				refreshedToken, refreshedErr := s.tokens.EnsureValidGitHubTokenForUser(ctx, project.OwnerUserID, true)
				if refreshedErr != nil {
					if errors.Is(refreshedErr, githubdomain.ErrReauthRequired) {
						warningCode = githubdomain.WarningCodeReauthRequired
					} else {
						s.logger.Printf("refresh github token for commit metadata error: %v", refreshedErr)
					}
				} else {
					fresh, fetchErr = s.github.FetchCommitMetadata(ctx, refreshedToken, project.RepoOwner, project.RepoName, missing)
				}
			}

			if fetchErr != nil {
				if errors.Is(fetchErr, githubdomain.ErrUnauthorized) || errors.Is(fetchErr, githubdomain.ErrReauthRequired) {
					warningCode = githubdomain.WarningCodeReauthRequired
				} else {
					s.logger.Printf("fetch commit metadata from github error: %v", fetchErr)
				}
			} else if len(fresh) > 0 {
				upsertEntries := make([]annotationsdomain.CommitMetadataCacheEntry, 0, len(fresh))
				for _, entry := range fresh {
					cacheEntry := annotationsdomain.CommitMetadataCacheEntry{
						CommitSHA:   strings.TrimSpace(entry.CommitSHA),
						Message:     strings.TrimSpace(entry.Message),
						CommittedAt: entry.CommittedAt,
						HTMLURL:     strings.TrimSpace(entry.HTMLURL),
						Branches:    append([]string(nil), entry.Branches...),
						Parents:     append([]string(nil), entry.Parents...),
						FetchedAt:   now,
					}
					upsertEntries = append(upsertEntries, cacheEntry)
					cached[cacheEntry.CommitSHA] = cacheEntry
				}

				if err := s.repo.UpsertCommitMetadataCache(ctx, project.ProjectID, upsertEntries); err != nil {
					s.logger.Printf("upsert commit metadata cache error: %v", err)
				}
			}
		}
	}

	commits := make([]annotationsdomain.CommitHistoryEntry, 0, len(stats))
	for _, stat := range stats {
		entry := stat
		if meta, exists := resolveCachedCommit(stat.CommitSHA, cached); exists {
			entry.Message = meta.Message
			entry.HTMLURL = meta.HTMLURL
			entry.Branches = meta.Branches
		}
		commits = append(commits, entry)
	}

	return CommitHistoryResult{Commits: commits, WarningCode: warningCode}, nil
}

func resolveCachedCommit(
	sha string,
	cached map[string]annotationsdomain.CommitMetadataCacheEntry,
) (annotationsdomain.CommitMetadataCacheEntry, bool) {
	if entry, exists := cached[sha]; exists {
		return entry, true
	}
	for key, entry := range cached {
		if strings.HasPrefix(key, sha) || strings.HasPrefix(sha, key) {
			return entry, true
		}
	}
	return annotationsdomain.CommitMetadataCacheEntry{}, false
}
