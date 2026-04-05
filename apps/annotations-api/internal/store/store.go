package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")

type ThreadStatus string

const (
	ThreadStatusOpen     ThreadStatus = "open"
	ThreadStatusResolved ThreadStatus = "resolved"
)

type Project struct {
	ProjectID string
	Name      string
}

type Message struct {
	MessageID string    `json:"messageId"`
	Body      string    `json:"body"`
	Author    string    `json:"author,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Thread struct {
	ThreadID    string          `json:"threadId"`
	ProjectID   string          `json:"projectId,omitempty"`
	Environment string          `json:"environment,omitempty"`
	PageKey     string          `json:"pageKey"`
	CommitSHA   string          `json:"commitSha"`
	Status      ThreadStatus    `json:"status"`
	Anchor      json.RawMessage `json:"anchor"`
	Messages    []Message       `json:"messages"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

type CreateThreadInput struct {
	ProjectID   string
	Environment string
	PageKey     string
	CommitSHA   string
	Anchor      json.RawMessage
	Body        string
	Author      string
}

type ReplyInput struct {
	ProjectID string
	ThreadID  string
	PageKey   string
	CommitSHA string
	Body      string
	Author    string
}

type MoveThreadAnchorInput struct {
	ProjectID string
	ThreadID  string
	PageKey   string
	CommitSHA string
	Anchor    json.RawMessage
}

type DeleteThreadInput struct {
	ProjectID string
	ThreadID  string
	PageKey   string
	CommitSHA string
}

type ListThreadsInput struct {
	ProjectID    string
	PageKey      string
	CommitSHA    string
	IncludeStale bool
	Environment  string
}

type Store struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) ResolveProjectByAPIKey(ctx context.Context, apiKey string) (Project, error) {
	var project Project
	err := s.db.QueryRow(ctx, `
		select p.project_id, p.name
		from api_keys k
		join projects p on p.project_id = k.project_id
		where k.api_key = $1 and k.active = true and p.active = true
	`, apiKey).Scan(&project.ProjectID, &project.Name)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return Project{}, ErrNotFound
		}
		return Project{}, fmt.Errorf("resolve project by api key: %w", err)
	}

	_, _ = s.db.Exec(ctx, `
		update api_keys
		set last_used_at = now()
		where api_key = $1 and active = true
	`, apiKey)

	return project, nil
}

func (s *Store) ListThreads(ctx context.Context, input ListThreadsInput) ([]Thread, error) {
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

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list threads: %w", err)
	}
	defer rows.Close()

	threadByID := map[string]*Thread{}
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
			thread = &Thread{
				ThreadID:    threadID,
				ProjectID:   projectID,
				Environment: environment,
				PageKey:     pageKey,
				CommitSHA:   commitSHA,
				Status:      ThreadStatus(status),
				Anchor:      json.RawMessage(anchor),
				Messages:    []Message{},
				CreatedAt:   createdAt,
				UpdatedAt:   updatedAt,
			}
			threadByID[threadID] = thread
			orderedIDs = append(orderedIDs, threadID)
		}

		if messageID != nil && messageBody != nil && messageCreatedAt != nil {
			msg := Message{
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

	threads := make([]Thread, 0, len(orderedIDs))
	for _, threadID := range orderedIDs {
		threads = append(threads, *threadByID[threadID])
	}

	return threads, nil
}

func (s *Store) CreateThread(ctx context.Context, input CreateThreadInput) (Thread, error) {
	now := time.Now().UTC()
	threadID := randomID("thread")
	messageID := randomID("msg")

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Thread{}, fmt.Errorf("begin create thread tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, `
		insert into annotation_threads (
			thread_id, project_id, environment, page_key, commit_sha, status, anchor, created_at, updated_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`, threadID, input.ProjectID, nullIfEmpty(input.Environment), input.PageKey, input.CommitSHA, ThreadStatusOpen, input.Anchor, now, now); err != nil {
		return Thread{}, fmt.Errorf("insert thread: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		insert into annotation_thread_messages (
			message_id, thread_id, body, author, created_at
		) values ($1,$2,$3,$4,$5)
	`, messageID, threadID, input.Body, nullIfEmpty(input.Author), now); err != nil {
		return Thread{}, fmt.Errorf("insert first message: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Thread{}, fmt.Errorf("commit create thread: %w", err)
	}

	return s.GetThread(ctx, input.ProjectID, threadID)
}

func (s *Store) AddReply(ctx context.Context, input ReplyInput) (Thread, error) {
	now := time.Now().UTC()
	messageID := randomID("msg")

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Thread{}, fmt.Errorf("begin add reply tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	commandTag, err := tx.Exec(ctx, `
		insert into annotation_thread_messages (message_id, thread_id, body, author, created_at)
		select $1, t.thread_id, $2, $3, $4
		from annotation_threads t
		where t.thread_id = $5 and t.project_id = $6 and t.page_key = $7 and t.commit_sha = $8
	`, messageID, input.Body, nullIfEmpty(input.Author), now, input.ThreadID, input.ProjectID, input.PageKey, input.CommitSHA)
	if err != nil {
		return Thread{}, fmt.Errorf("insert reply message: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return Thread{}, ErrNotFound
	}

	if _, err := tx.Exec(ctx, `
		update annotation_threads
		set updated_at = $1
		where thread_id = $2 and project_id = $3
	`, now, input.ThreadID, input.ProjectID); err != nil {
		return Thread{}, fmt.Errorf("touch thread: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Thread{}, fmt.Errorf("commit add reply: %w", err)
	}

	return s.GetThread(ctx, input.ProjectID, input.ThreadID)
}

func (s *Store) SetThreadStatus(ctx context.Context, projectID, threadID string, status ThreadStatus) (Thread, error) {
	now := time.Now().UTC()
	commandTag, err := s.db.Exec(ctx, `
		update annotation_threads
		set status = $1, updated_at = $2
		where thread_id = $3 and project_id = $4
	`, status, now, threadID, projectID)
	if err != nil {
		return Thread{}, fmt.Errorf("update thread status: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return Thread{}, ErrNotFound
	}

	return s.GetThread(ctx, projectID, threadID)
}

func (s *Store) MoveThreadAnchor(ctx context.Context, input MoveThreadAnchorInput) (Thread, error) {
	now := time.Now().UTC()
	commandTag, err := s.db.Exec(ctx, `
		update annotation_threads
		set anchor = $1, updated_at = $2
		where thread_id = $3 and project_id = $4 and page_key = $5 and commit_sha = $6
	`, input.Anchor, now, input.ThreadID, input.ProjectID, input.PageKey, input.CommitSHA)
	if err != nil {
		return Thread{}, fmt.Errorf("update thread anchor: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return Thread{}, ErrNotFound
	}

	return s.GetThread(ctx, input.ProjectID, input.ThreadID)
}

func (s *Store) DeleteThread(ctx context.Context, input DeleteThreadInput) error {
	commandTag, err := s.db.Exec(ctx, `
		delete from annotation_threads
		where thread_id = $1 and project_id = $2 and page_key = $3 and commit_sha = $4
	`, input.ThreadID, input.ProjectID, input.PageKey, input.CommitSHA)
	if err != nil {
		return fmt.Errorf("delete thread: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) GetThread(ctx context.Context, projectID, threadID string) (Thread, error) {
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

	rows, err := s.db.Query(ctx, query, projectID, threadID)
	if err != nil {
		return Thread{}, fmt.Errorf("get thread query: %w", err)
	}
	defer rows.Close()

	var thread *Thread
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
			return Thread{}, fmt.Errorf("scan get thread row: %w", err)
		}

		if thread == nil {
			thread = &Thread{
				ThreadID:    rowThreadID,
				ProjectID:   project,
				Environment: environment,
				PageKey:     pageKey,
				CommitSHA:   commitSHA,
				Status:      ThreadStatus(status),
				Anchor:      json.RawMessage(anchor),
				Messages:    []Message{},
				CreatedAt:   createdAt,
				UpdatedAt:   updatedAt,
			}
		}

		if messageID != nil && messageBody != nil && messageCreatedAt != nil {
			msg := Message{
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
		return Thread{}, fmt.Errorf("iterate get thread rows: %w", err)
	}
	if thread == nil {
		return Thread{}, ErrNotFound
	}

	return *thread, nil
}
