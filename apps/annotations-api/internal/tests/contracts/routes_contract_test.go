package contracts_test

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	accountapp "github.com/deshlo/annotations-api/internal/modules/account/application"
	accountdomain "github.com/deshlo/annotations-api/internal/modules/account/domain"
	accounthttp "github.com/deshlo/annotations-api/internal/modules/account/http"
	annotationsapp "github.com/deshlo/annotations-api/internal/modules/annotations/application"
	annotationsdomain "github.com/deshlo/annotations-api/internal/modules/annotations/domain"
	annotationshttp "github.com/deshlo/annotations-api/internal/modules/annotations/http"
	authapp "github.com/deshlo/annotations-api/internal/modules/auth/application"
	authdomain "github.com/deshlo/annotations-api/internal/modules/auth/domain"
	authhttp "github.com/deshlo/annotations-api/internal/modules/auth/http"
	githubdomain "github.com/deshlo/annotations-api/internal/modules/github/domain"
	platformerrors "github.com/deshlo/annotations-api/internal/platform/errors"
	"github.com/deshlo/annotations-api/internal/platform/middleware"
	security "github.com/deshlo/annotations-api/internal/platform/security"
	platformserver "github.com/deshlo/annotations-api/internal/platform/server"
)

const testJWTSecret = "test-secret"

type testHarness struct {
	handler         http.Handler
	authRepo        *fakeAuthRepo
	accountRepo     *fakeAccountRepo
	annotationsRepo *fakeAnnotationsRepo
	githubClient    *fakeGitHubClient
}

func newHarness(t *testing.T) *testHarness {
	t.Helper()

	logger := log.New(io.Discard, "", 0)
	authRepo := newFakeAuthRepo()
	accountRepo := &fakeAccountRepo{}
	annotationsRepo := newFakeAnnotationsRepo()
	githubClient := &fakeGitHubClient{}

	authService := authapp.NewService(authRepo, githubClient, authapp.OAuthConfig{
		DashboardURL: "http://localhost:3001/dashboard",
		JWTSecret:    testJWTSecret,
		JWTTTL:       time.Hour,
	}, logger)
	accountService := accountapp.NewService(accountRepo, authService, githubClient, logger)
	annotationsService := annotationsapp.NewService(annotationsRepo, authService, githubClient, logger)

	userAuth := middleware.NewUserAuth(testJWTSecret, authService, logger)
	apiKeyAuth := middleware.NewAPIKeyAuth(annotationsRepo, logger)

	handler := platformserver.NewHandler(platformserver.RouterConfig{
		AuthHandler:        authhttp.NewHandler(authService),
		AccountHandler:     accounthttp.NewHandler(accountService),
		AnnotationsHandler: annotationshttp.NewHandler(annotationsService),
		RequireUser:        userAuth,
		RequireAPIKey:      apiKeyAuth,
	})

	return &testHarness{
		handler:         handler,
		authRepo:        authRepo,
		accountRepo:     accountRepo,
		annotationsRepo: annotationsRepo,
		githubClient:    githubClient,
	}
}

func TestAuthStartAndLogoutContract(t *testing.T) {
	h := newHarness(t)

	startReq := httptest.NewRequest(http.MethodGet, "/v1/auth/github/start", nil)
	startRes := httptest.NewRecorder()
	h.handler.ServeHTTP(startRes, startReq)

	if startRes.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected 307 for auth start, got %d", startRes.Code)
	}
	location := startRes.Header().Get("Location")
	if !strings.HasPrefix(location, "https://github.com/login/oauth/authorize?") {
		t.Fatalf("unexpected auth redirect location: %s", location)
	}

	h.authRepo.users["usr_1"] = authdomain.User{UserID: "usr_1", GitHubID: "1", Name: "Nikos", Email: "n@example.com"}
	token, err := security.CreateUserToken(testJWTSecret, "usr_1", time.Hour)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	logoutReq := httptest.NewRequest(http.MethodPost, "/v1/account/logout", nil)
	logoutReq.Header.Set("Authorization", "Bearer "+token)
	logoutRes := httptest.NewRecorder()
	h.handler.ServeHTTP(logoutRes, logoutReq)
	if logoutRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for logout, got %d", logoutRes.Code)
	}

	payload := decodeJSONMap(t, logoutRes.Body.Bytes())
	if ok, _ := payload["ok"].(bool); !ok {
		t.Fatalf("expected logout ok=true, got payload=%v", payload)
	}
}

func TestMeAndProjectsContracts(t *testing.T) {
	h := newHarness(t)

	h.authRepo.users["usr_1"] = authdomain.User{UserID: "usr_1", GitHubID: "1", Name: "Nikos", Email: "n@example.com"}
	h.accountRepo.userProjects = map[string][]accountdomain.UserProject{
		"usr_1": {{ProjectID: "proj_1", Name: "repo-one", Active: true}},
	}

	unauthReq := httptest.NewRequest(http.MethodGet, "/v1/account/me", nil)
	unauthRes := httptest.NewRecorder()
	h.handler.ServeHTTP(unauthRes, unauthReq)
	if unauthRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for /v1/account/me without auth, got %d", unauthRes.Code)
	}

	token, err := security.CreateUserToken(testJWTSecret, "usr_1", time.Hour)
	if err != nil {
		t.Fatalf("create token: %v", err)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/v1/account/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+token)
	meRes := httptest.NewRecorder()
	h.handler.ServeHTTP(meRes, meReq)
	if meRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for /v1/account/me, got %d", meRes.Code)
	}

	mePayload := decodeJSONMap(t, meRes.Body.Bytes())
	if ok, _ := mePayload["ok"].(bool); !ok {
		t.Fatalf("expected me ok=true, got payload=%v", mePayload)
	}

	projectsReq := httptest.NewRequest(http.MethodGet, "/v1/account/projects", nil)
	projectsReq.Header.Set("Authorization", "Bearer "+token)
	projectsRes := httptest.NewRecorder()
	h.handler.ServeHTTP(projectsRes, projectsReq)
	if projectsRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for /v1/account/projects, got %d", projectsRes.Code)
	}

	projectsPayload := decodeJSONMap(t, projectsRes.Body.Bytes())
	if ok, _ := projectsPayload["ok"].(bool); !ok {
		t.Fatalf("expected projects ok=true, got payload=%v", projectsPayload)
	}
	projectsValue, exists := projectsPayload["projects"]
	if !exists {
		t.Fatalf("expected projects field, got payload=%v", projectsPayload)
	}
	if projectsSlice, ok := projectsValue.([]any); !ok || len(projectsSlice) != 1 {
		t.Fatalf("expected one project, got %T %#v", projectsValue, projectsValue)
	}

	keysReq := httptest.NewRequest(http.MethodGet, "/v1/account/keys", nil)
	keysReq.Header.Set("Authorization", "Bearer "+token)
	keysRes := httptest.NewRecorder()
	h.handler.ServeHTTP(keysRes, keysReq)
	if keysRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for /v1/account/keys, got %d", keysRes.Code)
	}
	keysPayload := decodeJSONMap(t, keysRes.Body.Bytes())
	if ok, _ := keysPayload["ok"].(bool); !ok {
		t.Fatalf("expected keys ok=true, got payload=%v", keysPayload)
	}
}

func TestRemovedLegacyRoutesReturnNotFound(t *testing.T) {
	h := newHarness(t)

	cases := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/v1/me"},
		{method: http.MethodPost, path: "/v1/auth/logout"},
		{method: http.MethodGet, path: "/v1/github/repos"},
		{method: http.MethodGet, path: "/v1/projects"},
		{method: http.MethodGet, path: "/v1/keys"},
		{method: http.MethodDelete, path: "/v1/keys/key_123"},
		{method: http.MethodGet, path: "/v1/projects/proj_1/keys"},
		{method: http.MethodPost, path: "/v1/projects/proj_1/keys"},
		{method: http.MethodPost, path: "/v1/projects/proj_1/keys/key_1/revoke"},
		{method: http.MethodGet, path: "/v1/admin/projects"},
		{method: http.MethodPost, path: "/v1/projects/resolve"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		h.handler.ServeHTTP(res, req)
		if res.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for removed route %s %s, got %d", tc.method, tc.path, res.Code)
		}
	}
}

func TestAnnotationsResolveAndCommitHistoryContracts(t *testing.T) {
	h := newHarness(t)

	project := accountdomain.Project{
		ProjectID:   "proj_annot",
		Name:        "annot-project",
		RepoOwner:   "owner",
		RepoName:    "repo",
		OwnerUserID: "usr_missing_token",
	}
	h.annotationsRepo.projectsByAPIKey["pk_valid"] = project
	h.annotationsRepo.commitStats = []annotationsdomain.CommitHistoryEntry{{
		CommitSHA:     "31a934bb",
		Threads:       2,
		Comments:      5,
		LatestUpdated: time.Now().UTC(),
	}}

	resolveReq := httptest.NewRequest(http.MethodPost, "/v1/annotations/resolve", nil)
	resolveReq.Header.Set("X-Deshlo-API-Key", "pk_valid")
	resolveRes := httptest.NewRecorder()
	h.handler.ServeHTTP(resolveRes, resolveReq)
	if resolveRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for resolve project, got %d", resolveRes.Code)
	}

	resolvePayload := decodeJSONMap(t, resolveRes.Body.Bytes())
	projectPayload, ok := resolvePayload["project"].(map[string]any)
	if !ok {
		t.Fatalf("expected project object in resolve payload, got %v", resolvePayload)
	}
	if projectPayload["projectId"] != "proj_annot" {
		t.Fatalf("expected projectId proj_annot, got %v", projectPayload)
	}

	commitReq := httptest.NewRequest(http.MethodGet, "/v1/commit-history?pageKey=http://localhost:3000/&environment=dev", nil)
	commitReq.Header.Set("X-Deshlo-API-Key", "pk_valid")
	commitRes := httptest.NewRecorder()
	h.handler.ServeHTTP(commitRes, commitReq)
	if commitRes.Code != http.StatusOK {
		t.Fatalf("expected 200 for commit-history, got %d", commitRes.Code)
	}

	commitPayload := decodeJSONMap(t, commitRes.Body.Bytes())
	if commitPayload["warningCode"] != githubdomain.WarningCodeReauthRequired {
		t.Fatalf("expected warningCode %s, got payload=%v", githubdomain.WarningCodeReauthRequired, commitPayload)
	}
	if commits, ok := commitPayload["commits"].([]any); !ok || len(commits) != 1 {
		t.Fatalf("expected one commit in response, got payload=%v", commitPayload)
	}
}

func decodeJSONMap(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode response body: %v (body=%s)", err, string(body))
	}
	return payload
}

type fakeAuthRepo struct {
	users        map[string]authdomain.User
	tokenBundles map[string]authdomain.GitHubTokenBundle
}

func newFakeAuthRepo() *fakeAuthRepo {
	return &fakeAuthRepo{
		users:        map[string]authdomain.User{},
		tokenBundles: map[string]authdomain.GitHubTokenBundle{},
	}
}

func (r *fakeAuthRepo) UpsertGitHubUser(_ context.Context, input authdomain.UpsertGitHubUserInput) (authdomain.User, error) {
	user := authdomain.User{UserID: "usr_1", GitHubID: input.GitHubID, Email: input.Email, Name: input.Name, AvatarURL: input.AvatarURL, CreatedAt: time.Now().UTC()}
	r.users[user.UserID] = user
	r.tokenBundles[user.UserID] = authdomain.GitHubTokenBundle{
		AccessToken:           input.GitHubAccessToken,
		RefreshToken:          input.GitHubRefreshToken,
		AccessTokenExpiresAt:  input.AccessTokenExpiresAt,
		RefreshTokenExpiresAt: input.RefreshTokenExpiresAt,
	}
	return user, nil
}

func (r *fakeAuthRepo) GetUserByID(_ context.Context, userID string) (authdomain.User, error) {
	user, ok := r.users[userID]
	if !ok {
		return authdomain.User{}, platformerrors.ErrNotFound
	}
	return user, nil
}

func (r *fakeAuthRepo) GetUserGitHubTokenBundle(_ context.Context, userID string) (authdomain.GitHubTokenBundle, error) {
	bundle, ok := r.tokenBundles[userID]
	if !ok {
		return authdomain.GitHubTokenBundle{}, platformerrors.ErrNotFound
	}
	return bundle, nil
}

func (r *fakeAuthRepo) WithUserGitHubTokenLock(
	_ context.Context,
	userID string,
	fn func(current authdomain.GitHubTokenBundle) (authdomain.GitHubTokenBundle, error),
) (authdomain.GitHubTokenBundle, error) {
	current, ok := r.tokenBundles[userID]
	if !ok {
		return authdomain.GitHubTokenBundle{}, platformerrors.ErrNotFound
	}
	updated, err := fn(current)
	if err != nil {
		return authdomain.GitHubTokenBundle{}, err
	}
	r.tokenBundles[userID] = updated
	return updated, nil
}

type fakeGitHubClient struct{}

func (c *fakeGitHubClient) AuthorizeURL(state string) string {
	return "https://github.com/login/oauth/authorize?state=" + state
}

func (c *fakeGitHubClient) ExchangeCode(_ context.Context, _ string, _ string) (githubdomain.OAuthTokenExchange, error) {
	return githubdomain.OAuthTokenExchange{AccessToken: "ghu_test", RefreshToken: "ghr_test"}, nil
}

func (c *fakeGitHubClient) ExchangeRefreshToken(_ context.Context, _ string) (githubdomain.OAuthTokenExchange, error) {
	return githubdomain.OAuthTokenExchange{}, githubdomain.ErrReauthRequired
}

func (c *fakeGitHubClient) FetchProfile(_ context.Context, _ string) (githubdomain.UserProfile, error) {
	return githubdomain.UserProfile{ID: 1, Login: "tester", Name: "Tester", Email: "test@example.com"}, nil
}

func (c *fakeGitHubClient) FetchPrimaryEmail(_ context.Context, _ string) (string, error) {
	return "test@example.com", nil
}

func (c *fakeGitHubClient) FetchRepos(_ context.Context, _ string) ([]githubdomain.Repository, error) {
	return []githubdomain.Repository{}, nil
}

func (c *fakeGitHubClient) FetchRepoByFullName(_ context.Context, _ string, fullName string) (githubdomain.Repository, error) {
	parts := strings.SplitN(fullName, "/", 2)
	if len(parts) != 2 {
		return githubdomain.Repository{}, githubdomain.ErrNotFound
	}
	return githubdomain.Repository{
		Name:     parts[1],
		FullName: fullName,
		HTMLURL:  "https://github.com/" + fullName,
		Owner:    githubdomain.RepositoryOwner{Login: parts[0]},
	}, nil
}

func (c *fakeGitHubClient) FetchCommitMetadata(
	_ context.Context,
	_ string,
	_ string,
	_ string,
	commitSHAs []string,
) (map[string]githubdomain.CommitMetadata, error) {
	result := make(map[string]githubdomain.CommitMetadata, len(commitSHAs))
	for _, sha := range commitSHAs {
		result[sha] = githubdomain.CommitMetadata{
			CommitSHA: sha,
			Message:   "Commit " + sha,
			HTMLURL:   "https://github.com/example/repo/commit/" + sha,
		}
	}
	return result, nil
}

type fakeAccountRepo struct {
	userProjects map[string][]accountdomain.UserProject
	userKeys     map[string][]accountdomain.UserAPIKeyWithProject
}

func (r *fakeAccountRepo) ListUserProjects(_ context.Context, ownerUserID string) ([]accountdomain.UserProject, error) {
	if r.userProjects == nil {
		return []accountdomain.UserProject{}, nil
	}
	return r.userProjects[ownerUserID], nil
}

func (r *fakeAccountRepo) ListUserAPIKeys(_ context.Context, ownerUserID string) ([]accountdomain.UserAPIKeyWithProject, error) {
	if r.userKeys == nil {
		return []accountdomain.UserAPIKeyWithProject{}, nil
	}
	return r.userKeys[ownerUserID], nil
}

func (r *fakeAccountRepo) CreateUserAPIKeyForRepo(_ context.Context, input accountdomain.CreateUserAPIKeyForRepoInput) (accountdomain.CreatedUserAPIKey, accountdomain.UserProject, error) {
	return accountdomain.CreatedUserAPIKey{KeyID: "key_1", ProjectID: "proj_1", APIKey: "pk_live_1", CreatedAt: time.Now().UTC()}, accountdomain.UserProject{ProjectID: "proj_1", Name: input.Name, RepoFullName: input.RepoFullName, Active: true}, nil
}

func (r *fakeAccountRepo) DeleteUserAPIKey(_ context.Context, _ string, keyID string) error {
	if strings.TrimSpace(keyID) == "" {
		return platformerrors.ErrNotFound
	}
	return nil
}

type fakeAnnotationsRepo struct {
	projectsByAPIKey map[string]accountdomain.Project
	threads          []annotationsdomain.Thread
	commitStats      []annotationsdomain.CommitHistoryEntry
	cache            map[string]annotationsdomain.CommitMetadataCacheEntry
}

func newFakeAnnotationsRepo() *fakeAnnotationsRepo {
	return &fakeAnnotationsRepo{
		projectsByAPIKey: map[string]accountdomain.Project{},
		threads:          []annotationsdomain.Thread{},
		commitStats:      []annotationsdomain.CommitHistoryEntry{},
		cache:            map[string]annotationsdomain.CommitMetadataCacheEntry{},
	}
}

func (r *fakeAnnotationsRepo) ResolveProjectByAPIKey(_ context.Context, apiKey string) (accountdomain.Project, error) {
	project, ok := r.projectsByAPIKey[apiKey]
	if !ok {
		return accountdomain.Project{}, platformerrors.ErrNotFound
	}
	return project, nil
}

func (r *fakeAnnotationsRepo) ListThreads(_ context.Context, _ annotationsdomain.ListThreadsInput) ([]annotationsdomain.Thread, error) {
	return r.threads, nil
}

func (r *fakeAnnotationsRepo) CreateThread(_ context.Context, input annotationsdomain.CreateThreadInput) (annotationsdomain.Thread, error) {
	thread := annotationsdomain.Thread{ThreadID: "thread_1", ProjectID: input.ProjectID, PageKey: input.PageKey, CommitSHA: input.CommitSHA, Status: annotationsdomain.ThreadStatusOpen, Anchor: input.Anchor, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	r.threads = append(r.threads, thread)
	return thread, nil
}

func (r *fakeAnnotationsRepo) AddReply(_ context.Context, input annotationsdomain.ReplyInput) (annotationsdomain.Thread, error) {
	for _, thread := range r.threads {
		if thread.ThreadID == input.ThreadID {
			return thread, nil
		}
	}
	return annotationsdomain.Thread{}, platformerrors.ErrNotFound
}

func (r *fakeAnnotationsRepo) SetThreadStatus(_ context.Context, _ string, threadID string, status annotationsdomain.ThreadStatus) (annotationsdomain.Thread, error) {
	for i := range r.threads {
		if r.threads[i].ThreadID == threadID {
			r.threads[i].Status = status
			return r.threads[i], nil
		}
	}
	return annotationsdomain.Thread{}, platformerrors.ErrNotFound
}

func (r *fakeAnnotationsRepo) MoveThreadAnchor(_ context.Context, input annotationsdomain.MoveThreadAnchorInput) (annotationsdomain.Thread, error) {
	for i := range r.threads {
		if r.threads[i].ThreadID == input.ThreadID {
			r.threads[i].Anchor = input.Anchor
			return r.threads[i], nil
		}
	}
	return annotationsdomain.Thread{}, platformerrors.ErrNotFound
}

func (r *fakeAnnotationsRepo) DeleteThread(_ context.Context, input annotationsdomain.DeleteThreadInput) error {
	for i := range r.threads {
		if r.threads[i].ThreadID == input.ThreadID {
			r.threads = append(r.threads[:i], r.threads[i+1:]...)
			return nil
		}
	}
	return platformerrors.ErrNotFound
}

func (r *fakeAnnotationsRepo) ListCommitHistoryStats(_ context.Context, _ string, _ string, _ string) ([]annotationsdomain.CommitHistoryEntry, error) {
	return r.commitStats, nil
}

func (r *fakeAnnotationsRepo) GetCommitMetadataCache(_ context.Context, _ string, _ []string) (map[string]annotationsdomain.CommitMetadataCacheEntry, error) {
	result := make(map[string]annotationsdomain.CommitMetadataCacheEntry, len(r.cache))
	for k, v := range r.cache {
		result[k] = v
	}
	return result, nil
}

func (r *fakeAnnotationsRepo) UpsertCommitMetadataCache(_ context.Context, _ string, entries []annotationsdomain.CommitMetadataCacheEntry) error {
	if r.cache == nil {
		r.cache = make(map[string]annotationsdomain.CommitMetadataCacheEntry, len(entries))
	}
	for _, entry := range entries {
		r.cache[entry.CommitSHA] = entry
	}
	return nil
}
