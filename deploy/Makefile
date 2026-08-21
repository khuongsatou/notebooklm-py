# Convenience wrapper for the remote notebooklm-mcp deploy.
#   make dev                    — use .env.development + build this checkout
#   make dev TUNNEL=tailscale   — same, but with the Tailscale Funnel sidecar
#   make prod VERSION=x.y.z     — use .env.production + install a PyPI release
#   make logs / restart / down / config
# TUNNEL selects the tunnel sidecar (Compose profile): cloudflare (default) or tailscale.
# ENV selects the environment file: .env.development or .env.production.
# Override the compose command with COMPOSE=... if needed.

COMPOSE ?= docker compose
ENV ?= development
ENV_FILE ?= .env.$(ENV)
TUNNEL ?= cloudflare
VERSION ?= 0.8.0

# Prefer the selected environment file, but keep legacy deploy/.env working for
# existing VPS setups. If neither exists, shell-exported variables can still drive
# compose and the token pre-check below.
RESOLVED_ENV_FILE = $(if $(wildcard $(ENV_FILE)),$(ENV_FILE),$(if $(wildcard .env),.env,))
ENV_FILE_ARG = $(if $(RESOLVED_ENV_FILE),--env-file $(RESOLVED_ENV_FILE),)

# Profile-aware compose invocation — selects exactly one tunnel sidecar.
DC = $(COMPOSE) $(ENV_FILE_ARG) --profile $(TUNNEL)

# Run the container as YOUR uid/gid so the mounted profile needs no chown.
export NOTEBOOKLM_UID ?= $(shell id -u)
export NOTEBOOKLM_GID ?= $(shell id -g)
# NOTE: do NOT set/export NOTEBOOKLM_PROFILE_DIR here. make does not read .env, so a
# `?=` default would resolve to "default" and `export` would push it into compose's
# env, where it OUTRANKS the .env value (shell env > .env) — silently ignoring the
# user's `.env` setting. Compose reads NOTEBOOKLM_PROFILE_DIR from .env directly and
# defaults to ~/.notebooklm/profiles/default on its own; a shell/CLI override such as
# `NOTEBOOKLM_PROFILE_DIR=… make dev` is still auto-exported by make to the recipe.

.PHONY: help dev prod up restart logs down config _require-tunnel-token

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-9s\033[0m %s\n", $$1, $$2}'

# Friendly pre-check for the chosen tunnel's token (shell env OR the resolved env file).
# Compose can't do a profile-scoped required-var (it interpolates the whole file before
# profile filtering), so the guard lives here instead of a `:?` in docker-compose.yml.
_require-tunnel-token:
	@if [ "$(TUNNEL)" = "cloudflare" ]; then \
		{ [ -n "$$CF_TUNNEL_TOKEN" ] || { [ -n "$(RESOLVED_ENV_FILE)" ] && grep -qsE '^CF_TUNNEL_TOKEN=.+' "$(RESOLVED_ENV_FILE)"; }; } \
			|| { echo "✗ TUNNEL=cloudflare needs CF_TUNNEL_TOKEN — set it in deploy/$(ENV_FILE)"; exit 1; }; \
	elif [ "$(TUNNEL)" = "tailscale" ]; then \
		{ [ -n "$$TS_AUTHKEY" ] || { [ -n "$(RESOLVED_ENV_FILE)" ] && grep -qsE '^TS_AUTHKEY=.+' "$(RESOLVED_ENV_FILE)"; }; } \
			|| { echo "✗ TUNNEL=tailscale needs TS_AUTHKEY — set it in deploy/$(ENV_FILE)"; exit 1; }; \
	else echo "✗ Unknown TUNNEL=$(TUNNEL) (use cloudflare or tailscale)"; exit 1; fi

dev: ENV=development
dev: _require-tunnel-token ## Build from source (this checkout) and start (TUNNEL=cloudflare|tailscale)
	$(DC) up -d --build

prod: ENV=production
prod: _require-tunnel-token ## Build from a published release and start (e.g. make prod VERSION=0.8.0)
	$(DC) build --build-arg NOTEBOOKLM_SPEC="notebooklm-py[mcp,headless]==$(VERSION)"
	$(DC) up -d

up: dev ## Alias for `dev`

restart: ## Rebuild + recreate after a source/config change
	$(DC) up -d --build

logs: ## Tail the server logs
	$(COMPOSE) logs -f notebooklm-mcp

down: ## Stop and remove the stack (pass the same TUNNEL you started with)
	$(DC) down

config: ## Validate the merged compose config
	$(DC) config
