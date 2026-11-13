# OIDC SSO (external IdP)

CoreEngine does **not** ship an OAuth authorization server. SSO uses an external OIDC IdP (Keycloak, Auth0, Okta, Entra ID, …). The BFF is the relying party: Authorization Code + PKCE → verify ID token via JWKS → link `app_users` → issue the normal CoreEngine session (HS256 access JWT + opaque refresh).

MFA / enterprise login policies are configured **on the IdP**, not inside CoreEngine.

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

Local email/password login stays available (`AUTH_BACKEND=local`).

## Identity link

1. Match `app_users.oidc_issuer` + `oidc_subject` (`sub`).
2. Else, if `email_verified === true` and the email domain is allowed, match a **non-admin** local user by email and store issuer/subject.
3. Else if `OIDC_JIT_PROVISION=true` (requires `OIDC_DEFAULT_ROLE_BACKEND_ID` + `OIDC_ALLOWED_EMAIL_DOMAINS`), create a user in the default role.
4. Else reject (admin must provision the user first).

**Hardening**

- ID tokens must include `email_verified: true` (missing or false is rejected).
- Multi-audience ID tokens must include `azp` equal to `OIDC_CLIENT_ID`.
- Admin accounts (`app_roles.is_admin`) are **never** linked by email — set `oidc_issuer` / `oidc_subject` explicitly (SQL or future Setup action) before first SSO login.
- `/auth/oidc/login` sets an HttpOnly `SameSite=Lax` cookie with a hash of `state`; the callback rejects mismatches (login CSRF).
- Browser callback failures use generic `?sso_error=` codes (`sso_failed` / `sso_denied` / `sso_unavailable`); details are logged on the BFF only.
- Discovery/token HTTP calls time out (10s). Internal issuer URL rewrite matches on a `/` boundary only.
- App logout after SSO also hits `/auth/oidc/logout` with `id_token_hint` (HttpOnly cookie set when the session ticket is redeemed).
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

## Local Keycloak

```bash
docker compose -f docker-compose.keycloak.yml --profile oidc up -d
```

Import realm: `docker/keycloak/realm-coreengine.json` (client `coreengine`, user `admin@example.com`).

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
# Optional: create unknown emails into a role (domain allowlist required)
# OIDC_JIT_PROVISION=true
# OIDC_DEFAULT_ROLE_BACKEND_ID=<backend_role_id>
# OIDC_ALLOWED_EMAIL_DOMAINS=example.com
```

Apply migration `202611130001_oidc_subject.sql` (via `npm run registry:migrate` / provision).

Restart the BFF. Login page shows **Sign in with Keycloak** when `GET /auth/oidc/status` reports `enabled: true`.

## Auth0 / other IdPs

Create a Regular Web Application (confidential client) with:

- Callback: `https://<bff-host>/auth/oidc/callback`
- Logout URLs: `https://<ui-host>/login`
- Grant: Authorization Code
- Scopes: `openid profile email`

Set the same `OIDC_*` env vars to that tenant’s issuer and client credentials. Always use a unique client secret — committed examples leave `OIDC_CLIENT_SECRET` empty.

## Multi-instance BFF

PKCE state and one-time session tickets are **in-process memory** (capped; expired entries pruned). The CSRF state cookie only proves the browser started the flow on **this** node if the pending map lives elsewhere — use a single BFF instance for SSO, sticky sessions, or a shared store (Redis, etc.) before horizontal scale-out.

## MCP (later)

A future MCP resource-server path can validate IdP access tokens via JWKS directly. UI SSO does not require that — it bridges to CoreEngine sessions today.
