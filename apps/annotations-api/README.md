# @deshlo/annotations-api (Go + PostgreSQL)

Backend for Deshlo live annotations and customer onboarding.

## Features

- GitHub OAuth login and JWT user auth
- Self-serve projects and API keys per user
- API-key authenticated annotation thread endpoints

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
- `DESHLO_TOKEN_ENCRYPTION_KEY` (16/24/32-byte key, raw/base64/hex)
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

OAuth scope includes repository access so users can pick a real GitHub repo for each project.

User-authenticated endpoints use:

- `Authorization: Bearer <jwt>`

### Account (user-scoped)

- `GET /v1/account/me`
- `POST /v1/account/logout`
- `GET /v1/account/repos`
- `GET /v1/account/projects`
- `GET /v1/account/keys`
- `POST /v1/account/keys` (requires `repoFullName`, e.g. `owner/repo`; project is auto-assigned/created)
- `DELETE /v1/account/keys/{keyID}`

### Annotation runtime (project API key)

- `POST /v1/annotations/resolve`
- `GET /v1/threads?pageKey=<url>&commitSha=<sha>&includeStale=true|false&environment=<env>`
- `GET /v1/commit-history?pageKey=<url>&environment=<env>` (`warningCode` may be `GITHUB_REAUTH_REQUIRED`)
- `POST /v1/threads`
- `POST /v1/threads/{threadID}/replies`
- `POST /v1/threads/{threadID}/resolve`
- `POST /v1/threads/{threadID}/reopen`

Runtime auth header:

- `X-Deshlo-API-Key: pk_...`

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
