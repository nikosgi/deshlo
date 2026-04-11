package domain

import "time"

type Project struct {
	ProjectID    string
	Name         string
	RepoOwner    string
	RepoName     string
	RepoFullName string
	RepoHTMLURL  string
	OwnerUserID  string
}

type UserProject struct {
	ProjectID    string    `json:"projectId"`
	Name         string    `json:"name"`
	RepoOwner    string    `json:"repoOwner,omitempty"`
	RepoName     string    `json:"repoName,omitempty"`
	RepoFullName string    `json:"repoFullName,omitempty"`
	RepoHTMLURL  string    `json:"repoHtmlUrl,omitempty"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CreateUserProjectInput struct {
	OwnerUserID  string
	Name         string
	RepoOwner    string
	RepoName     string
	RepoFullName string
	RepoHTMLURL  string
}

type UserAPIKey struct {
	KeyID      string     `json:"keyId"`
	ProjectID  string     `json:"projectId"`
	Preview    string     `json:"preview"`
	Active     bool       `json:"active"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

type CreatedUserAPIKey struct {
	KeyID     string    `json:"keyId"`
	ProjectID string    `json:"projectId"`
	APIKey    string    `json:"apiKey"`
	CreatedAt time.Time `json:"createdAt"`
}

type UserAPIKeyWithProject struct {
	KeyID        string     `json:"keyId"`
	ProjectID    string     `json:"projectId"`
	ProjectName  string     `json:"projectName"`
	RepoFullName string     `json:"repoFullName,omitempty"`
	Preview      string     `json:"preview"`
	Active       bool       `json:"active"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
}

type CreateUserAPIKeyForRepoInput struct {
	OwnerUserID  string
	Name         string
	RepoOwner    string
	RepoName     string
	RepoFullName string
	RepoHTMLURL  string
}
