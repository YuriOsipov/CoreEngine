#!/usr/bin/env bash
# One-shot lightweight install: Postgres + BFF (+ optional stub UI).
# Usage (repo root):
#   ./scripts/install-minimal.sh
#   ./scripts/install-minimal.sh --domain sales --with-ui
# n8n is not started here. Customers pull that upstream image themselves:
#   docker compose -f docker-compose.minimal.yml --profile automation up -d n8n
# Activepieces starts with this stack (restart: always). --with-activepieces is accepted and ignored.
#   ./scripts/install-minimal.sh --admin-password 'ChooseAUniqueSecret!'
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.minimal.yml)
DOMAIN=sales
WITH_UI=0
ADMIN_PASSWORD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-sales}"
      shift 2
      ;;
    --with-ui)
      WITH_UI=1
      shift
      ;;
    --with-n8n)
      echo "This installer does not start n8n. Pull the upstream image yourself:" >&2
      echo "  docker compose -f docker-compose.minimal.yml --profile automation up -d n8n" >&2
      echo "See THIRD_PARTY.md. Sell implementation and support, not n8n access." >&2
      exit 1
      ;;
    --with-activepieces)
      # Activepieces is part of the default stack. Keep the flag so older commands still run.
      shift
      ;;
    --admin-password)
      ADMIN_PASSWORD="${2:-}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,9p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

rand_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '\n/+=' | head -c 32
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n/+=' | head -c 32
  fi
}

ensure_env() {
  if [[ ! -f .env ]]; then
    cp .env.docker.example .env
    echo "==> Created .env from .env.docker.example"
  fi
  # Minimal stack uses its own DB name (not Supabase's `postgres`).
  if grep -q '^POSTGRES_DB=' .env; then
    sed -i.bak 's/^POSTGRES_DB=.*/POSTGRES_DB=coreengine/' .env && rm -f .env.bak
  else
    echo 'POSTGRES_DB=coreengine' >> .env
  fi

  set_kv() {
    local key="$1" val="$2"
    if grep -q "^${key}=" .env; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
    else
      echo "${key}=${val}" >> .env
    fi
  }

  local pw app_pw
  pw="$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2- || true)"
  app_pw="$(grep -E '^POSTGRES_APP_PASSWORD=' .env | head -1 | cut -d= -f2- || true)"
  if [[ -z "${pw}" ]]; then
    pw="$(rand_secret)"
    set_kv POSTGRES_PASSWORD "$pw"
    echo "==> Generated POSTGRES_PASSWORD in .env"
  fi
  if [[ -z "${app_pw}" ]]; then
    app_pw="$(rand_secret)"
    set_kv POSTGRES_APP_PASSWORD "$app_pw"
    set_kv POSTGRES_BOOTSTRAP_PASSWORD "$app_pw"
    echo "==> Generated POSTGRES_APP_PASSWORD in .env"
  fi

  ensure_kv() {
    local key="$1" val="$2" cur
    cur="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2- || true)"
    if [[ -z "${cur}" ]]; then
      set_kv "$key" "$val"
      echo "==> Generated ${key} in .env"
    fi
  }
  rand_hex() {
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex "$1"
    else
      head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
  }
  ensure_kv AP_ENCRYPTION_KEY "$(rand_hex 16)"
  ensure_kv AP_JWT_SECRET "$(rand_hex 32)"
  ensure_kv AP_POSTGRES_PASSWORD "$(rand_secret)"
  ensure_kv ACTIVEPIECES_WEBHOOK_SECRET "$(rand_secret)"
  ensure_kv ACTIVEPIECES_BASE_URL "http://activepieces:80"

  cp .env supabase/.env
  echo "==> Synced supabase/.env from .env"
}

ensure_env

echo "==> Starting Postgres"
"${COMPOSE[@]}" up -d db

echo "==> Waiting for Postgres health"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T db pg_isready -U postgres -d coreengine >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

PROVISION_ARGS=(--domain "$DOMAIN")
if [[ -n "$ADMIN_PASSWORD" ]]; then
  PROVISION_ARGS+=(--admin-password "$ADMIN_PASSWORD")
fi

echo "==> Provisioning kernel + pack (${DOMAIN})"
"${COMPOSE[@]}" run --rm --workdir /app bff \
  npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
  ./scripts/provision-platform-db.mts "${PROVISION_ARGS[@]}"

echo "==> Starting BFF"
"${COMPOSE[@]}" up -d bff

echo "==> Starting Activepieces (restart: always)"
"${COMPOSE[@]}" up -d activepieces activepieces-worker

if [[ "$WITH_UI" -eq 1 ]]; then
  echo "==> Building optional web UI (@docengine/* from npm, or npm run docengine:use-local)"
  "${COMPOSE[@]}" --profile ui up -d --build web
fi

echo
echo "Lightweight install ready."
echo "  BFF health: http://localhost:4000/health"
if [[ "$WITH_UI" -eq 1 ]]; then
  echo "  UI:         http://localhost:8080"
fi
echo "  n8n:        not started. Pull upstream yourself if you want it (see THIRD_PARTY.md):"
echo "              docker compose -f docker-compose.minimal.yml --profile automation up -d n8n"
echo "  Activepieces: http://127.0.0.1:8081 (restarts with Docker)"
echo "  Login:      admin@example.com (password from provision output above)"
echo "  Upgrade:    see docs/upgrading.md"
echo "  Backup:     see docs/backup-restore.md"
echo "  Support:    see SUPPORT.md"
