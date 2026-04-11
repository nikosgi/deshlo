package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	accountdomain "github.com/deshlo/annotations-api/internal/modules/account/domain"
	annotationsapp "github.com/deshlo/annotations-api/internal/modules/annotations/application"
	annotationsdomain "github.com/deshlo/annotations-api/internal/modules/annotations/domain"
	"github.com/deshlo/annotations-api/internal/platform/dbutil"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

var _ annotationsapp.Repository = (*Repository)(nil)

func (r *Repository) ResolveProjectByAPIKey(ctx context.Context, apiKey string) (accountdomain.Project, error) {
	var project accountdomain.Project
	err := r.db.QueryRow(ctx, `
		select
			p.project_id,
			p.name,
			coalesce(p.repo_owner, ''),
			coalesce(p.repo_name, ''),
			coalesce(p.repo_full_name, ''),
			coalesce(p.repo_html_url, ''),
			coalesce(p.owner_user_id, '')
		from api_keys k
		join projects p on p.project_id = k.project_id
		where k.api_key = $1 and k.active = true and p.active = true
	`, apiKey).Scan(
		&project.ProjectID,
		&project.Name,
		&project.RepoOwner,
		&project.RepoName,
		&project.RepoFullName,
		&project.RepoHTMLURL,
		&project.OwnerUserID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return accountdomain.Project{}, platformerrors.ErrNotFound
		}
		return accountdomain.Project{}, fmt.Errorf("resolve project by api key: %w", err)
	}

	_, _ = r.db.Exec(ctx, `
		update api_keys
		set last_used_at = now()
		where api_key = $1 and active = true
	`, apiKey)

	return project, nil
}

func (r *Repository) ListThreads(ctx context.Context, input annotationsdomain.ListThreadsInput) ([]annotationsdomain.Thread, error) {
	args := []any{input.ProjectID, input.PageKey}
	where := []string{"t.project_id = $1", "t.page_key = $2"}

	if input.Environment != "" {
		args = append(args, input.Environment)
		where = append(where, fmt.Sprintf("t.environment = $%d", len(args)))
	}

	if !input.IncludeStale {
		args = append(args, input.CommitSHA)
		where = append(where, fmt.Sprintf("t.commit_sha = $%d", len(args)))
	}

	query := `
		select
			t.thread_id,
			t.project_id,
			coalesce(t.environment, ''),
			t.page_key,
			t.commit_sha,
			t.status,
			t.anchor,
			t.created_at,
			t.updated_at,
			m.message_id,
			m.body,
			coalesce(m.author, ''),
			m.created_at
		from annotation_threads t
		left join annotation_thread_messages m on m.thread_id = t.thread_id
		where ` + strings.Join(where, " and ") + `
		order by t.updated_at desc, m.created_at asc
	`

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list threads: %w", err)
	}
	defer rows.Close()

	threadByID := map[string]*annotationsdomain.Thread{}
	orderedIDs := make([]string, 0)

	for rows.Next() {
		var (
			threadID    string
			projectID   string
			environment string
			pageKey     string
			commitSHA   string
			status      string
			anchor      []byte
			createdAt   time.Time
			updatedAt   time.Time

			messageID        *string
			messageBody      *string
			messageAuthor    *string
			messageCreatedAt *time.Time
		)

		if err := rows.Scan(
			&threadID,
			&projectID,
			&environment,
			&pageKey,
			&commitSHA,
			&status,
			&anchor,
			&createdAt,
			&updatedAt,
			&messageID,
			&messageBody,
			&messageAuthor,
			&messageCreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan thread row: %w", err)
		}

		thread, exists := threadByID[threadID]
		if !exists {
			thread = &annotationsdomain.Thread{
				ThreadID:    threadID,
				ProjectID:   projectID,
				Environment: environment,
				PageKey:     pageKey,
				CommitSHA:   commitSHA,
				Status:      annotationsdomain.ThreadStatus(status),
				Anchor:      json.RawMessage(anchor),
				Messages:    []annotationsdomain.Message{},
				CreatedAt:   createdAt,
				UpdatedAt:   updatedAt,
			}
			threadByID[threadID] = thread
			orderedIDs = append(orderedIDs, threadID)
		}

		if messageID != nil && messageBody != nil && messageCreatedAt != nil {
			msg := annotationsdomain.Message{
				MessageID: *messageID,
				Body:      *messageBody,
				CreatedAt: *messageCreatedAt,
			}
			if messageAuthor != nil {
				msg.Author = *messageAuthor
			}
			thread.Messages = append(thread.Messages, msg)
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate threads: %w", err)
	}

	threads := make([]annotationsdomain.Thread, 0, len(orderedIDs))
	for _, threadID := range orderedIDs {
		threads = append(threads, *threadByID[threadID])
	}

	return threads, nil
}

func (r *Repository) CreateThread(ctx context.Context, input annotationsdomain.CreateThreadInput) (annotationsdomain.Thread, error) {
	now := time.Now().UTC()
	threadID := dbutil.RandomID("thread")
	messageID := dbutil.RandomID("msg")

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("begin create thread tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, `
		insert into annotation_threads (
			thread_id, project_id, environment, page_key, commit_sha, status, anchor, created_at, updated_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, threadID, input.ProjectID, dbutil.NullIfEmpty(input.Environment), input.PageKey, input.CommitSHA, annotationsdomain.ThreadStatusOpen, input.Anchor, now, now); err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("insert thread: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		insert into annotation_thread_messages (
			message_id, thread_id, body, author, created_at
		) values ($1,$2,$3,$4,$5)
	`, messageID, threadID, input.Body, dbutil.NullIfEmpty(input.Author), now); err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("insert first message: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("commit create thread: %w", err)
	}

	return r.getThread(ctx, input.ProjectID, threadID)
}

func (r *Repository) AddReply(ctx context.Context, input annotationsdomain.ReplyInput) (annotationsdomain.Thread, error) {
	now := time.Now().UTC()
	messageID := dbutil.RandomID("msg")

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("begin add reply tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	commandTag, err := tx.Exec(ctx, `
		insert into annotation_thread_messages (message_id, thread_id, body, author, created_at)
		select $1, t.thread_id, $2, $3, $4
		from annotation_threads t
		where t.thread_id = $5 and t.project_id = $6 and t.page_key = $7 and t.commit_sha = $8
	`, messageID, input.Body, dbutil.NullIfEmpty(input.Author), now, input.ThreadID, input.ProjectID, input.PageKey, input.CommitSHA)
	if err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("insert reply message: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return annotationsdomain.Thread{}, platformerrors.ErrNotFound
	}

	if _, err := tx.Exec(ctx, `
		update annotation_threads
		set updated_at = $1
		where thread_id = $2 and project_id = $3
	`, now, input.ThreadID, input.ProjectID); err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("touch thread: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("commit add reply: %w", err)
	}

	return r.getThread(ctx, input.ProjectID, input.ThreadID)
}

func (r *Repository) SetThreadStatus(ctx context.Context, projectID, threadID string, status annotationsdomain.ThreadStatus) (annotationsdomain.Thread, error) {
	now := time.Now().UTC()
	commandTag, err := r.db.Exec(ctx, `
		update annotation_threads
		set status = $1, updated_at = $2
		where thread_id = $3 and project_id = $4
	`, status, now, threadID, projectID)
	if err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("update thread status: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return annotationsdomain.Thread{}, platformerrors.ErrNotFound
	}

	return r.getThread(ctx, projectID, threadID)
}

func (r *Repository) MoveThreadAnchor(ctx context.Context, input annotationsdomain.MoveThreadAnchorInput) (annotationsdomain.Thread, error) {
	now := time.Now().UTC()
	commandTag, err := r.db.Exec(ctx, `
		update annotation_threads
		set anchor = $1, updated_at = $2
		where thread_id = $3 and project_id = $4 and page_key = $5 and commit_sha = $6
	`, input.Anchor, now, input.ThreadID, input.ProjectID, input.PageKey, input.CommitSHA)
	if err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("update thread anchor: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return annotationsdomain.Thread{}, platformerrors.ErrNotFound
	}

	return r.getThread(ctx, input.ProjectID, input.ThreadID)
}

func (r *Repository) DeleteThread(ctx context.Context, input annotationsdomain.DeleteThreadInput) error {
	commandTag, err := r.db.Exec(ctx, `
		delete from annotation_threads
		where thread_id = $1 and project_id = $2 and page_key = $3 and commit_sha = $4
	`, input.ThreadID, input.ProjectID, input.PageKey, input.CommitSHA)
	if err != nil {
		return fmt.Errorf("delete thread: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return platformerrors.ErrNotFound
	}
	return nil
}

func (r *Repository) getThread(ctx context.Context, projectID, threadID string) (annotationsdomain.Thread, error) {
	query := `
		select
			t.thread_id,
			t.project_id,
			coalesce(t.environment, ''),
			t.page_key,
			t.commit_sha,
			t.status,
			t.anchor,
			t.created_at,
			t.updated_at,
			m.message_id,
			m.body,
			coalesce(m.author, ''),
			m.created_at
		from annotation_threads t
		left join annotation_thread_messages m on m.thread_id = t.thread_id
		where t.project_id = $1 and t.thread_id = $2
		order by m.created_at asc
	`

	rows, err := r.db.Query(ctx, query, projectID, threadID)
	if err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("get thread query: %w", err)
	}
	defer rows.Close()

	var thread *annotationsdomain.Thread
	for rows.Next() {
		var (
			rowThreadID      string
			project          string
			environment      string
			pageKey          string
			commitSHA        string
			status           string
			anchor           []byte
			createdAt        time.Time
			updatedAt        time.Time
			messageID        *string
			messageBody      *string
			messageAuthor    *string
			messageCreatedAt *time.Time
		)
		if err := rows.Scan(
			&rowThreadID,
			&project,
			&environment,
			&pageKey,
			&commitSHA,
			&status,
			&anchor,
			&createdAt,
			&updatedAt,
			&messageID,
			&messageBody,
			&messageAuthor,
			&messageCreatedAt,
		); err != nil {
			return annotationsdomain.Thread{}, fmt.Errorf("scan get thread row: %w", err)
		}

		if thread == nil {
			thread = &annotationsdomain.Thread{
				ThreadID:    rowThreadID,
				ProjectID:   project,
				Environment: environment,
				PageKey:     pageKey,
				CommitSHA:   commitSHA,
				Status:      annotationsdomain.ThreadStatus(status),
				Anchor:      json.RawMessage(anchor),
				Messages:    []annotationsdomain.Message{},
				CreatedAt:   createdAt,
				UpdatedAt:   updatedAt,
			}
		}

		if messageID != nil && messageBody != nil && messageCreatedAt != nil {
			msg := annotationsdomain.Message{
				MessageID: *messageID,
				Body:      *messageBody,
				CreatedAt: *messageCreatedAt,
			}
			if messageAuthor != nil {
				msg.Author = *messageAuthor
			}
			thread.Messages = append(thread.Messages, msg)
		}
	}

	if err := rows.Err(); err != nil {
		return annotationsdomain.Thread{}, fmt.Errorf("iterate get thread rows: %w", err)
	}
	if thread == nil {
		return annotationsdomain.Thread{}, platformerrors.ErrNotFound
	}

	return *thread, nil
}

func (r *Repository) ListCommitHistoryStats(
	ctx context.Context,
	projectID string,
	pageKey string,
	environment string,
) ([]annotationsdomain.CommitHistoryEntry, error) {
	rows, err := r.db.Query(ctx, `
		select
			t.commit_sha,
			count(*)::int as threads,
			coalesce(sum(mc.message_count), 0)::int as comments,
			max(t.updated_at) as latest_updated_at
		from annotation_threads t
		left join (
			select thread_id, count(*)::int as message_count
			from annotation_thread_messages
			group by thread_id
		) mc on mc.thread_id = t.thread_id
		where
			t.project_id = $1
			and t.page_key = $2
			and ($3 = '' or coalesce(t.environment, '') = $3)
		group by t.commit_sha
		order by latest_updated_at desc
	`, strings.TrimSpace(projectID), strings.TrimSpace(pageKey), strings.TrimSpace(environment))
	if err != nil {
		return nil, fmt.Errorf("list commit history stats: %w", err)
	}
	defer rows.Close()

	entries := make([]annotationsdomain.CommitHistoryEntry, 0)
	for rows.Next() {
		var entry annotationsdomain.CommitHistoryEntry
		if err := rows.Scan(
			&entry.CommitSHA,
			&entry.Threads,
			&entry.Comments,
			&entry.LatestUpdated,
		); err != nil {
			return nil, fmt.Errorf("scan commit history stat: %w", err)
		}
		entry.Branches = []string{}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate commit history stats: %w", err)
	}

	return entries, nil
}

func (r *Repository) GetCommitMetadataCache(
	ctx context.Context,
	projectID string,
	commitSHAs []string,
) (map[string]annotationsdomain.CommitMetadataCacheEntry, error) {
	trimmedProjectID := strings.TrimSpace(projectID)
	if trimmedProjectID == "" || len(commitSHAs) == 0 {
		return map[string]annotationsdomain.CommitMetadataCacheEntry{}, nil
	}

	normalizedSHAs := make([]string, 0, len(commitSHAs))
	seen := make(map[string]struct{}, len(commitSHAs))
	for _, sha := range commitSHAs {
		trimmed := strings.TrimSpace(sha)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalizedSHAs = append(normalizedSHAs, trimmed)
	}
	if len(normalizedSHAs) == 0 {
		return map[string]annotationsdomain.CommitMetadataCacheEntry{}, nil
	}

	rows, err := r.db.Query(ctx, `
		select
			commit_sha,
			coalesce(message_headline, ''),
			committed_at,
			coalesce(html_url, ''),
			branches,
			parents,
			fetched_at
		from commit_metadata_cache
		where project_id = $1 and commit_sha = any($2)
	`, trimmedProjectID, normalizedSHAs)
	if err != nil {
		return nil, fmt.Errorf("get commit metadata cache: %w", err)
	}
	defer rows.Close()

	cached := make(map[string]annotationsdomain.CommitMetadataCacheEntry, len(normalizedSHAs))
	for rows.Next() {
		var (
			entry        annotationsdomain.CommitMetadataCacheEntry
			branchesJSON []byte
			parentsJSON  []byte
			committedAt  *time.Time
		)
		if err := rows.Scan(
			&entry.CommitSHA,
			&entry.Message,
			&committedAt,
			&entry.HTMLURL,
			&branchesJSON,
			&parentsJSON,
			&entry.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan commit metadata cache: %w", err)
		}
		if committedAt != nil {
			entry.CommittedAt = committedAt.UTC()
		}
		if len(branchesJSON) > 0 {
			_ = json.Unmarshal(branchesJSON, &entry.Branches)
		}
		if len(parentsJSON) > 0 {
			_ = json.Unmarshal(parentsJSON, &entry.Parents)
		}
		cached[entry.CommitSHA] = entry
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate commit metadata cache: %w", err)
	}

	return cached, nil
}

func (r *Repository) UpsertCommitMetadataCache(
	ctx context.Context,
	projectID string,
	entries []annotationsdomain.CommitMetadataCacheEntry,
) error {
	trimmedProjectID := strings.TrimSpace(projectID)
	if trimmedProjectID == "" || len(entries) == 0 {
		return nil
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin upsert commit metadata cache tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	for _, entry := range entries {
		commitSHA := strings.TrimSpace(entry.CommitSHA)
		if commitSHA == "" {
			continue
		}

		branchesJSON, err := json.Marshal(entry.Branches)
		if err != nil {
			return fmt.Errorf("marshal branches for %s: %w", commitSHA, err)
		}
		parentsJSON, err := json.Marshal(entry.Parents)
		if err != nil {
			return fmt.Errorf("marshal parents for %s: %w", commitSHA, err)
		}

		var committedAt any
		if entry.CommittedAt.IsZero() {
			committedAt = nil
		} else {
			committedAt = entry.CommittedAt.UTC()
		}

		if _, err := tx.Exec(ctx, `
			insert into commit_metadata_cache(
				project_id, commit_sha, message_headline, committed_at, html_url, branches, parents, fetched_at
			) values ($1,$2,$3,$4,$5,$6,$7,$8)
			on conflict (project_id, commit_sha)
			do update set
				message_headline = excluded.message_headline,
				committed_at = excluded.committed_at,
				html_url = excluded.html_url,
				branches = excluded.branches,
				parents = excluded.parents,
				fetched_at = excluded.fetched_at
		`,
			trimmedProjectID,
			commitSHA,
			dbutil.NullIfEmpty(strings.TrimSpace(entry.Message)),
			committedAt,
			dbutil.NullIfEmpty(strings.TrimSpace(entry.HTMLURL)),
			branchesJSON,
			parentsJSON,
			time.Now().UTC(),
		); err != nil {
			return fmt.Errorf("upsert commit metadata cache %s: %w", commitSHA, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit upsert commit metadata cache tx: %w", err)
	}

	return nil
}
