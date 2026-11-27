# OIDC SSO (external IdP)

CoreEngine does **not** ship an OAuth authorization server. SSO uses an external OIDC IdP (Keycloak, Auth0, Okta, Entra ID, …). The BFF is the relying party: Authorization Code + PKCE → verify ID token via JWKS → link `app_users` → issue the normal CoreEngine session (HS256 access JWT + opaque refresh).

MFA / enterprise login policies are configured **on the IdP**, not inside CoreEngine. Local email/password login is **on by default**. Set `AUTH_LOCAL_LOGIN_ENABLED=false` for SSO-only (hides the password form and rejects `POST /auth/login`) so IdP MFA cannot be bypassed.

## Flow

```text
Vue /login → GET /auth/oidc/login
  → IdP authorize (PKCE)
  → GET /auth/oidc/callback (BFF)
  → verify id_token + link user
  → redirect Vue /login/oidc/callback?ticket=…
  → POST /auth/oidc/session { ticket }
  → same localStorage session as password login
```

Local email/password login defaults to on (`AUTH_BACKEND=local`, `AUTH_LOCAL_LOGIN_ENABLED=true`).

## Identity link

1. Match `app_users.oidc_issuer` + `oidc_subject` (`sub`).
2. Else, if `email_verified === true` and the email domain is allowed, match a **non-admin** local user by email and store issuer/subject.
3. Else if `OIDC_JIT_PROVISION=true` (requires `OIDC_DEFAULT_ROLE_BACKEND_ID` + `OIDC_ALLOWED_EMAIL_DOMAINS`), create a user in the default role. The default role **must not** be an admin role (`app_roles.is_admin`).
4. Else reject (admin must provision the user first).

**Hardening**

- ID tokens must include `email_verified: true` (missing or false is rejected).
- Multi-audience ID tokens must include `azp` equal to `OIDC_CLIENT_ID`.
- Admin accounts (`app_roles.is_admin`) are **never** linked by email — set `oidc_issuer` / `oidc_subject` explicitly (SQL or future Setup action) before first SSO login.
- `/auth/oidc/login` sets an HttpOnly `SameSite=Lax` cookie with a hash of `state`; the callback rejects mismatches (login CSRF).
- Browser callback failures use generic `?sso_error=` codes (`sso_failed` / `sso_denied` / `sso_unavailable`); details are logged on the BFF only.
- Discovery/token HTTP calls time out (10s). Internal issuer URL rewrite matches on a `/` boundary only.
- App logout after SSO **POSTs** `/auth/oidc/logout` (not GET — avoids trivial logout CSRF via img/link) with `id_token_hint` (HttpOnly cookie set when the session ticket is redeemed).
- In-memory PKCE/ticket stores are size-capped; multi-instance BFF still needs sticky sessions or a shared store.

Admin flags and **roles** still come from the database — never from IdP claims or Keycloak groups. Assign CoreEngine roles in **Setup → Users / Roles**.

### Provisioning a new SSO user (JIT off — default)

1. CoreEngine: Setup → Users → create user (email + **non-admin** role).
2. Keycloak (`coreengine` realm): Users → Add user (same email, **Email verified On**) → Credentials → set password.
3. App login → **Sign in with Keycloak** → first login links by email.

### Linking an admin for SSO

Do **not** rely on email linking. After creating the IdP user, copy its `sub` into CoreEngine:

```sql
UPDATE public.app_users
SET oidc_issuer = 'http://localhost:8081/realms/coreengine',
    oidc_subject = '<Keycloak user sub>'
WHERE lower(email) = lower('admin@example.com');
```

Keycloak Groups / realm role mapping does not change CoreEngine ACL.

### Deprovisioning

There is **no SCIM** (or other IdP→CoreEngine user sync). Prefer an explicit CoreEngine deactivate:

1. Deactivate the user in **Setup → Users** (`app_users.is_active = false`) so refresh and guarded API calls fail immediately.
2. Optionally also disable/remove them in the IdP so SSO cannot mint a new link.

**SSO refresh IdP check (default on):** when a user signs in via OIDC and `OIDC_CHECK_ON_REFRESH` is on, the BFF stores **sealed** IdP access/refresh tokens on the CoreEngine refresh row (`app_refresh_tokens.oidc_*`, migrations `202611170001_*` / `202611170003_*`). Prefer a dedicated **`OIDC_TOKEN_ENCRYPTION_KEY`** in production; if unset, the seal key is derived from `AUTH_JWT_SECRET` (rotating the JWT secret then makes existing seals unreadable — treated as absent, not a 500). On `POST /auth/refresh`, the BFF peeks the live CE refresh row, calls IdP **userinfo** (and IdP refresh if needed), then consumes the CE token — storing **rotated** sealed IdP tokens on `app_refresh_token_consumed` for the 10s grace window. Those columns are **NULLed after ~60s**; the consumed hash row itself is kept for reuse detection (~30 days). Grace retries **do not** call the IdP again (avoids refresh-token reuse / Keycloak revoke-on-reuse). Concurrent refreshes of the same CE token are **single-flighted per BFF process**; a failed IdP check re-checks the consumed grace row before revoking (covers multi-instance losers that arrive after the winner consumed). A narrow cross-instance race remains if B’s IdP call fails before A consumes — accepted. **IdP outages (HTTP 429 / 5xx) and network errors return 503** and leave the CE refresh row intact — they never revoke sessions or deactivate users. A **real IdP reject** (4xx with an IdP refresh token present) revokes that user’s refresh tokens (HTTP 401). If only a short-lived access token is stored (no IdP refresh — e.g. scopes without `offline_access`), a failed userinfo check is **skipped** rather than locking the user out.

**Scopes:** when `OIDC_SCOPES` is unset and check-on-refresh is on, defaults are `openid profile email offline_access` (Auth0 needs **Allow Offline Access**; Keycloak realm import puts `offline_access` on the client’s default + optional scopes). Explicit `OIDC_SCOPES` is honored as-is (opt out of `offline_access` if the IdP client rejects it). When `OIDC_CHECK_ON_REFRESH=false`, defaults omit `offline_access`. Set `OIDC_DEACTIVATE_ON_IDP_REJECT=true` to also flip `is_active=false` on a real IdP reject — **admins are never deactivated** by this path.

Access JWTs remain valid until their short TTL (~15 minutes) after revoke. Local-password sessions do not carry IdP tokens — they still require Setup deactivate (or password rotate) when local login is enabled. With `AUTH_LOCAL_LOGIN_ENABLED=false`, only SSO can mint a new session.

## Local Keycloak

```bash
docker compose -f docker-compose.keycloak.yml --profile oidc up -d
```

Import realm: `docker/keycloak/realm-coreengine.json` (client `coreengine`, user `admin@example.com`). The client lists `offline_access` under both **default** and **optional** client scopes so the default authorize scopes (with check-on-refresh) do not get `invalid_scope`.

Enable in `.env` (set `OIDC_CLIENT_SECRET` from Keycloak → Clients → `coreengine` → Credentials — never commit the value):

```bash
OIDC_ENABLED=true
OIDC_ISSUER=http://localhost:8081/realms/coreengine
# When BFF runs in Docker, discovery/JWKS go via the Keycloak service name:
OIDC_INTERNAL_ISSUER=http://keycloak:8080/realms/coreengine
OIDC_CLIENT_ID=coreengine
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=http://localhost:4000/auth/oidc/callback
OIDC_UI_ORIGIN=http://localhost:5173
OIDC_DISPLAY_NAME=Keycloak
# OIDC_SCOPES=openid profile email offline_access
# OIDC_CHECK_ON_REFRESH=true
# Recommended in production (else derived from AUTH_JWT_SECRET):
# OIDC_TOKEN_ENCRYPTION_KEY=
# Behind TLS-terminating proxy:
# TRUST_PROXY=loopback,uniquelocal
# Optional: create unknown emails into a role (domain allowlist required)
# OIDC_JIT_PROVISION=true
# OIDC_DEFAULT_ROLE_BACKEND_ID=<non-admin backend_role_id>
# OIDC_ALLOWED_EMAIL_DOMAINS=example.com
```

Discovery endpoint URLs must share the `OIDC_ISSUER` origin (and `OIDC_INTERNAL_ISSUER` when set). Foreign hosts in the discovery document are rejected.

Apply migration `202611130001_oidc_subject.sql` (via `npm run registry:migrate` / provision).

Restart the BFF. Login page shows **Sign in with Keycloak** when `GET /auth/oidc/status` reports `enabled: true`.

## Auth0 / other IdPs

Create a Regular Web Application (confidential client) with:

- Callback: `https://<bff-host>/auth/oidc/callback`
- Logout URLs: `https://<ui-host>/login`
- Grant: Authorization Code
- Scopes: default `openid profile email offline_access` when check-on-refresh is on (or set `OIDC_SCOPES` explicitly). Enable **Allow Offline Access** / refresh tokens on Auth0; Keycloak quick-start realm already includes `offline_access`

Set the same `OIDC_*` env vars to that tenant’s issuer and client credentials. Always use a unique client secret — committed examples leave `OIDC_CLIENT_SECRET` empty.

## TLS / reverse proxy

OIDC state and `id_token_hint` cookies set `Secure` from `request.protocol === 'https'`. Behind a TLS-terminating proxy (nginx, load balancer), set **`TRUST_PROXY`** so Fastify honours `X-Forwarded-Proto` from allowed peers (compose defaults often use `loopback,uniquelocal`). If `TRUST_PROXY` is unset, the BFF sees plain `http` from the proxy hop and those cookies lose `Secure` on an otherwise-HTTPS site.

## Multi-instance BFF

PKCE state and one-time session tickets are **in-process memory** (capped; expired entries pruned). The CSRF state cookie only proves the browser started the flow on **this** node if the pending map lives elsewhere — use a single BFF instance for SSO, sticky sessions, or a shared store (Redis, etc.) before horizontal scale-out.

## MCP

CoreEngine MCP (`/api/v1/mcp`, see [`mcp.md`](./mcp.md)) authenticates with **CoreEngine Bearer** access tokens today (same as GraphQL / REST). A future resource-server path can validate IdP access tokens via JWKS directly. UI SSO does not require that — it bridges to CoreEngine sessions today.
