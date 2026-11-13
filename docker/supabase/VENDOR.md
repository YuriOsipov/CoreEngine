# Vendored from https://github.com/supabase/supabase/tree/189adda99d1b56da55fc5a6ee3f849354aaea92a/docker
#
# Pin: 189adda99d1b56da55fc5a6ee3f849354aaea92a (chore self-hosted update 2026-11-05)
# Included by the repo-root `docker-compose.yml` (Compose `include` + CoreEngine bff/web).
# Default gateway: Envoy (`api-gw`, aliases `envoy` / `kong`).
#
# CoreEngine patches vs upstream (re-apply after re-vendor):
# - `volumes/db/coreengine-app-role.sh` + db volume/env mount for supabase-safe `coreengine_app`
# - Supavisor host ports bound to `127.0.0.1` only
# - `.env.example` keys `POSTGRES_APP_USER` / `POSTGRES_APP_PASSWORD`
#
# Secrets: copy `.env.example` → `.env` here. Keep Supabase `JWT_SECRET` separate from
# CoreEngine `AUTH_JWT_SECRET` in the repo-root `.env`.
#
# Do not casually rewrite other service wiring — re-copy from upstream to upgrade.
# Dropped from upstream copy (optional): logging/s3/caddy/nginx helpers, update scripts, tests.
