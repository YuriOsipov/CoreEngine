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
2. Else match verified email and store issuer/subject.
3. Else if `OIDC_JIT_PROVISION=true`, create a user with `OIDC_DEFAULT_ROLE_BACKEND_ID`.
4. Else reject (admin must provision the user first).

Admin flags and **roles** still come from the database — never from IdP claims or Keycloak groups. Assign CoreEngine roles in **Setup → Users / Roles**.

### Provisioning a new SSO user (JIT off — default)

1. CoreEngine: Setup → Users → create user (email + role).
2. Keycloak (`coreengine` realm): Users → Add user (same email, Email verified On) → Credentials → set password.
3. App login → **Sign in with Keycloak** → first login links by email.

Keycloak Groups / realm role mapping does not change CoreEngine ACL.

## Local Keycloak

```bash
docker compose -f docker-compose.keycloak.yml --profile oidc up -d
```

Import realm: `docker/keycloak/realm-coreengine.json` (client `coreengine`, user `admin@example.com`).

Enable in `.env`:

```bash
OIDC_ENABLED=true
OIDC_ISSUER=http://localhost:8081/realms/coreengine
# When BFF runs in Docker, discovery/JWKS go via the Keycloak service name:
OIDC_INTERNAL_ISSUER=http://keycloak:8080/realms/coreengine
OIDC_CLIENT_ID=coreengine
OIDC_CLIENT_SECRET=coreengine-dev-client-secret-change-me
OIDC_REDIRECT_URI=http://localhost:4000/auth/oidc/callback
OIDC_UI_ORIGIN=http://localhost:5173
OIDC_DISPLAY_NAME=Keycloak
# Optional: create unknown emails into a role
# OIDC_JIT_PROVISION=true
# OIDC_DEFAULT_ROLE_BACKEND_ID=<backend_role_id>
```

Apply migration `202611130001_oidc_subject.sql` (via `npm run registry:migrate` / provision).

Restart the BFF. Login page shows **Sign in with Keycloak** when `GET /auth/oidc/status` reports `enabled: true`.

## Auth0 / other IdPs

Create a Regular Web Application (confidential client) with:

- Callback: `https://<bff-host>/auth/oidc/callback`
- Logout URLs: `https://<ui-host>/login`
- Grant: Authorization Code
- Scopes: `openid profile email`

Set the same `OIDC_*` env vars to that tenant’s issuer and client credentials. Change the client secret from the Keycloak dev default.

## Multi-instance BFF

PKCE state and one-time session tickets are **in-process memory**. Use a single BFF instance for SSO, sticky sessions, or replace the store before horizontal scale-out.

## MCP (later)

A future MCP resource-server path can validate IdP access tokens via JWKS directly. UI SSO does not require that — it bridges to CoreEngine sessions today.
