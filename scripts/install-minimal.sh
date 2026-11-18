#!/usr/bin/env bash
# One-shot lightweight install: Postgres + BFF (+ optional stub UI).
# Usage (repo root):
#   ./scripts/install-minimal.sh
#   ./scripts/install-minimal.sh --domain sales --with-ui
#   ./scripts/install-minimal.sh --domain clinic --with-n8n
#   ./scripts/install-minimal.sh --admin-password 'ChooseAUniqueSecret!'
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.minimal.yml)
DOMAIN=sales
WITH_UI=0
WITH_N8N=0
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
      WITH_N8N=1
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

if [[ "$WITH_UI" -eq 1 ]]; then
  echo "==> Building optional web UI (DocEngine stubs — sibling ../docEngine needed for full editor)"
  "${COMPOSE[@]}" --profile ui up -d --build web
fi

if [[ "$WITH_N8N" -eq 1 ]]; then
  set_kv() {
    local key="$1" val="$2"
    if grep -q "^${key}=" .env; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
    else
      echo "${key}=${val}" >> .env
    fi
  }
  n8n_env_changed=0
  if ! grep -q '^N8N_WEBHOOK_SECRET=.\+' .env 2>/dev/null; then
    set_kv N8N_WEBHOOK_SECRET "$(rand_secret)"
    n8n_env_changed=1
  fi
  if ! grep -q '^N8N_BASE_URL=.\+' .env 2>/dev/null; then
    set_kv N8N_BASE_URL 'http://n8n:5678'
    n8n_env_changed=1
  fi
  if ! grep -q '^FLOWS_HTTP_ALLOWED_HOSTS=.\+' .env 2>/dev/null; then
    set_kv FLOWS_HTTP_ALLOWED_HOSTS 'n8n,n8n:5678'
    n8n_env_changed=1
  fi
  if [[ "$n8n_env_changed" -eq 1 ]]; then
    cp .env supabase/.env
    echo "==> Wrote n8n env (N8N_BASE_URL / secret / allowlist); restarting BFF"
    "${COMPOSE[@]}" up -d bff
  fi
  echo "==> Seeding Integration user + n8n pack flow keys (${DOMAIN})"
  "${COMPOSE[@]}" run --rm --workdir /app bff \
    npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
    ./scripts/seed-n8n-automation-user.mts || true
  "${COMPOSE[@]}" run --rm --workdir /app bff \
    npx --prefix ./crm-bff tsx --env-file=.env --env-file=supabase/.env \
    ./scripts/seed-n8n-pack-flows.mts --pack="$DOMAIN"
  echo "==> Starting n8n (import docs/n8n/*.workflow.json, then activate)"
  "${COMPOSE[@]}" --profile automation up -d n8n
fi

echo
echo "Lightweight install ready."
echo "  BFF health: http://localhost:4000/health"
if [[ "$WITH_UI" -eq 1 ]]; then
  echo "  UI:         http://localhost:8080"
fi
if [[ "$WITH_N8N" -eq 1 ]]; then
  echo "  n8n:        http://localhost:5678  (see docs/n8n/README.md)"
fi
echo "  Login:      admin@example.com (password from provision output above)"
echo "  Upgrade:    see docs/upgrading.md"
echo "  Backup:     see docs/backup-restore.md"
echo "  Support:    see SUPPORT.md"
