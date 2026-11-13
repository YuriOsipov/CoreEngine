# Security Policy

CoreEngine is a public MIT repository. We appreciate responsible disclosure of security issues.

## Supported versions

Security fixes are applied on the default branch (`main`). There is no long-term support channel yet; upgrade by pulling / redeploying `main` (or a release tag when published).

## Reporting a vulnerability

**Do not** open a public GitHub issue for suspected vulnerabilities (auth bypass, privilege escalation, data leak, injection, secret exposure, etc.).

Please report privately via one of:

1. **GitHub Security Advisories** — [Report a vulnerability](https://github.com/YuriOsipov/CoreEngine/security/advisories/new) on this repository (preferred when available).
2. **Email the maintainer** — use the contact on the GitHub profile of [YuriOsipov](https://github.com/YuriOsipov) if advisories are unavailable.

Include:

- Affected component (BFF route / resolver, Vue surface, Docker / provision scripts, etc.)
- Steps to reproduce or a minimal PoC
- Impact (who can exploit it, what data or actions are exposed)
- Your preferred credit name (or request anonymity)

We will acknowledge receipt when we can, triage severity, and coordinate a fix before any public write-up.

## Out of scope (for triage expectations)

- Issues that require already having database / Hasura / Directus admin credentials, or a compromised `AUTH_JWT_SECRET`
- Missing **full row-level sharing** (share rules / groups / hierarchy — see README). Opt-in **owner** RLS (`user_created`) is implemented; reporting “sharing rules” as complete when only owner mode exists is a docs bug
- Denial-of-service from unbounded legitimate authenticated queries without a concrete auth/authorization flaw
- Vulnerabilities only in third-party services you wire yourself (n8n, Hasura, Directus) when those endpoints are exposed contrary to the deployment checklist

## Deployment reminders

Operators should follow the **Security model and deployment checklist** in [`README.md`](README.md): verified JWTs and short-lived access tokens, admin flags from the database, admin-only Setup mutations, field sensitivity tiers, no public Hasura/Directus, single scheduler instance, TLS termination, and rate limiting at the edge.

For SSO, use an external OIDC IdP (`OIDC_*` — see [`docs/oidc-sso.md`](docs/oidc-sso.md)). Rotate IdP client secrets, enable MFA on the IdP, and do not trust IdP role claims for CoreEngine admin.
