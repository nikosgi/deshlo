# @deshlo/annotations-api (Go + PostgreSQL)

Backend for Deshlo live annotations and customer onboarding.

## Features

- GitHub OAuth login and JWT user auth
- Self-serve projects and API keys per user
- API-key authenticated annotation thread endpoints
- Internal admin-token endpoints kept for bootstrap/support

## Run locally

1. Start database + pgAdmin:

```bash
docker compose up -d postgres pgadmin
```

2. Copy env and set required auth values:

```bash
cp .env.example .env
```

Required in `.env`:

- `DESHLO_JWT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URL` (default: `http://localhost:8080/v1/auth/github/callback`)
- `DASHBOARD_URL` (default: `http://localhost:3002`)

3. Start API:

```bash
make run-env
```

## Customer API

### Auth

- `GET /v1/auth/github/start`
- `GET /v1/auth/github/callback`
- `POST /v1/auth/logout`
- `GET /v1/me`
- `GET /v1/github/repos`

OAuth scope includes repository access so users can pick a real GitHub repo for each project.

User-authenticated endpoints use:

- `Authorization: Bearer <jwt>`

### Projects / Keys (user-scoped)

- `GET /v1/projects`
- `GET /v1/keys`
- `POST /v1/keys` (requires `repoFullName`, e.g. `owner/repo`; project is auto-assigned/created)
- `DELETE /v1/keys/{keyID}`

Legacy compatibility endpoints:

- `GET /v1/projects/{projectID}/keys`
- `POST /v1/projects/{projectID}/keys`
- `POST /v1/projects/{projectID}/keys/{keyID}/revoke`

### Annotation runtime (project API key)

- `POST /v1/projects/resolve`
- `GET /v1/threads?pageKey=<url>&commitSha=<sha>&includeStale=true|false&environment=<env>`
- `POST /v1/threads`
- `POST /v1/threads/{threadID}/replies`
- `POST /v1/threads/{threadID}/resolve`
- `POST /v1/threads/{threadID}/reopen`

Runtime auth header:

- `X-Deshlo-API-Key: pk_...`

## Internal admin API (compatibility)

These remain enabled for internal ops and are not the client onboarding path:

- `GET /v1/admin/projects`
- `POST /v1/admin/projects`
- `GET /v1/admin/projects/{projectID}/keys`
- `POST /v1/admin/projects/{projectID}/keys`

Header:

- `X-Deshlo-Admin-Token: <DESHLO_ADMIN_TOKEN>`

## Development

Hot reload:

```bash
go install github.com/air-verse/air@latest
make dev
```

## pgAdmin

- URL: `http://localhost:5050`
- Email: `PGADMIN_DEFAULT_EMAIL` (default `admin@deshlo.dev`)
- Password: `PGADMIN_DEFAULT_PASSWORD` (default `admin`)

Connection settings in pgAdmin:

- Host: `postgres`
- Port: `5432`
- Database: `deshlo_annotations`
- Username: `deshlo_app`
- Password: `deshlo_app`
