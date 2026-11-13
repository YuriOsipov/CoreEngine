#!/bin/bash
# Supabase-safe CoreEngine app role (runs once on fresh PGDATA).
# Creates coreengine_app with CREATE on public + ownership of crm_schema only.
# Does NOT steal database/public ownership from Supabase reserved roles.
set -euo pipefail

APP_USER="${POSTGRES_APP_USER:-coreengine_app}"
APP_PASSWORD="${POSTGRES_APP_PASSWORD:-}"
DB_NAME="${POSTGRES_DB:-postgres}"

if [ -z "$APP_PASSWORD" ]; then
  echo "coreengine-app-role: POSTGRES_APP_PASSWORD unset — skip (run ensure-app-db-role later)" >&2
  exit 0
fi

if [ "$APP_USER" = "postgres" ] || [ "$APP_USER" = "supabase_admin" ]; then
  echo "coreengine-app-role: POSTGRES_APP_USER must not be a reserved role" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" \
  --dbname "$DB_NAME" \
  --set app_user="$APP_USER" \
  --set app_password="$APP_PASSWORD" \
  --set db_name="$DB_NAME" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'app_user', :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'app_user', :'app_password'
)
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db_name', :'app_user')
\gexec
-- ddlSync ENSURE_SCHEMA needs CREATE on the database (not only on schemas).
SELECT format('GRANT CREATE ON DATABASE %I TO %I', :'db_name', :'app_user')
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec
SELECT format('GRANT USAGE ON SCHEMA extensions TO %I', :'app_user')
\gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO %I', :'app_user')
\gexec
SELECT format('CREATE SCHEMA IF NOT EXISTS crm_schema AUTHORIZATION %I', :'app_user')
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA crm_schema TO %I', :'app_user')
\gexec
SQL

echo "coreengine-app-role: ensured role ${APP_USER} (supabase-safe grants)"
