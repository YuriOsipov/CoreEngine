#!/bin/bash
# Runs once on a fresh data volume (docker-entrypoint-initdb.d).
# Creates the least-privilege role the BFF + provisioning connect as: it owns the
# CoreEngine database and public schema (needed for kernel migrations and
# crm_schema DDL sync) but is not a superuser and cannot create roles/databases.
set -euo pipefail

: "${POSTGRES_APP_USER:?POSTGRES_APP_USER is required}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is required}"

if [ "$POSTGRES_APP_USER" = "$POSTGRES_USER" ]; then
  echo "POSTGRES_APP_USER must differ from the superuser POSTGRES_USER" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_user="$POSTGRES_APP_USER" \
  --set app_password="$POSTGRES_APP_PASSWORD" \
  --set db_name="$POSTGRES_DB" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'app_user', :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'db_name', :'app_user') \gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
