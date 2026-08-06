# WhatsApp CRM — run from repo root
# Usage: make help

VPS_DIR := vps
LOCAL_COMPOSE := $(VPS_DIR)/docker-compose.local.yml
PROD_COMPOSE := $(VPS_DIR)/docker-compose.yml
FUNCTIONS_ENV := supabase/functions/.env

.PHONY: help install env \
	evolution-up evolution-down evolution-restart evolution-logs evolution-ps \
	supabase-start supabase-stop supabase-status supabase-db-push \
	functions-serve functions-deploy secrets-set \
	dev build lint preview \
	up down logs status

.DEFAULT_GOAL := help

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ── Setup ────────────────────────────────────────────────────────────────────

install: ## Install frontend dependencies
	npm install

env: ## Copy .env.example → .env if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready (edit VITE_SUPABASE_* values)"

# ── Evolution API (local Docker) ─────────────────────────────────────────────

evolution-up: ## Start local Evolution + Postgres (docker-compose.local.yml)
	docker compose -f $(LOCAL_COMPOSE) up -d

evolution-down: ## Stop local Evolution stack
	docker compose -f $(LOCAL_COMPOSE) down

evolution-restart: ## Restart local Evolution stack
	docker compose -f $(LOCAL_COMPOSE) restart

evolution-logs: ## Tail Evolution API logs
	docker compose -f $(LOCAL_COMPOSE) logs -f evolution

evolution-ps: ## Show local Evolution container status
	docker compose -f $(LOCAL_COMPOSE) ps

# ── Supabase (local) ─────────────────────────────────────────────────────────

supabase-start: ## Start local Supabase (API, DB, Studio)
	supabase start

supabase-stop: ## Stop local Supabase
	supabase stop

supabase-status: ## Show local Supabase status + keys
	supabase status

supabase-db-push: ## Apply migrations to linked / local DB
	supabase db push

# ── Edge Functions ───────────────────────────────────────────────────────────

functions-serve: ## Serve Edge Functions locally (uses supabase/functions/.env if present)
	@if [ -f $(FUNCTIONS_ENV) ]; then \
		supabase functions serve --env-file $(FUNCTIONS_ENV); \
	else \
		echo "Tip: create $(FUNCTIONS_ENV) with EVOLUTION_API_KEY/URL/INSTANCE"; \
		supabase functions serve; \
	fi

functions-deploy: ## Deploy all Edge Functions to linked remote project
	supabase functions deploy

secrets-set: ## Set Evolution secrets on linked remote (override via make VAR=...)
	@test -n "$(EVOLUTION_API_KEY)" || (echo "Set EVOLUTION_API_KEY=..."; exit 1)
	@test -n "$(EVOLUTION_API_URL)" || (echo "Set EVOLUTION_API_URL=..."; exit 1)
	@test -n "$(EVOLUTION_INSTANCE)" || (echo "Set EVOLUTION_INSTANCE=..."; exit 1)
	supabase secrets set \
		EVOLUTION_API_KEY=$(EVOLUTION_API_KEY) \
		EVOLUTION_API_URL=$(EVOLUTION_API_URL) \
		EVOLUTION_INSTANCE=$(EVOLUTION_INSTANCE)

# ── Frontend ─────────────────────────────────────────────────────────────────

dev: ## Run Vite frontend (http://localhost:5173)
	npm run dev

build: ## Production frontend build
	npm run build

lint: ## Lint frontend
	npm run lint

preview: ## Preview production build
	npm run preview

# ── Convenience ──────────────────────────────────────────────────────────────

up: evolution-up supabase-start ## Start Evolution + Supabase locally
	@echo ""
	@echo "Evolution:  http://localhost:8080  (API key: changeme123)"
	@echo "Supabase:   run 'make supabase-status' for URL + anon key"
	@echo "Frontend:   make dev"

down: evolution-down supabase-stop ## Stop Evolution + Supabase

logs: evolution-logs ## Alias for evolution-logs

status: evolution-ps supabase-status ## Show Evolution + Supabase status
