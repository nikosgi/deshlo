package domain

import (
	"encoding/json"
	"time"
)

type ThreadStatus string

const (
	ThreadStatusOpen     ThreadStatus = "open"
	ThreadStatusResolved ThreadStatus = "resolved"
)

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

type CommitHistoryEntry struct {
	CommitSHA     string    `json:"commitSha"`
	Threads       int       `json:"threads"`
	Comments      int       `json:"comments"`
	LatestUpdated time.Time `json:"latestUpdatedAt"`
	Message       string    `json:"message,omitempty"`
	HTMLURL       string    `json:"htmlUrl,omitempty"`
	Branches      []string  `json:"branches,omitempty"`
}

type CommitMetadataCacheEntry struct {
	CommitSHA   string
	Message     string
	CommittedAt time.Time
	HTMLURL     string
	Branches    []string
	Parents     []string
	FetchedAt   time.Time
}
