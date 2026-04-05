.PHONY: run run-env dev build test fmt postgres-up postgres-down

run:
	go run ./cmd/server

run-env:
	@if [ ! -f .env ]; then echo ".env file not found"; exit 1; fi
	@set -a; . ./.env; set +a; go run ./cmd/server

dev:
	@if ! command -v air >/dev/null 2>&1; then echo "air is not installed. Install with: go install github.com/air-verse/air@latest"; exit 1; fi
	@if [ ! -f .env ]; then echo ".env file not found"; exit 1; fi
	@set -a; . ./.env; set +a; air -c .air.toml

build:
	go build ./...

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

postgres-up:
	docker compose up -d postgres

postgres-down:
	docker compose down
