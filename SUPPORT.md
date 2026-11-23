# Support

Community support only — **no paid SLA** and no dedicated support desk. Product scope: [README](README.md).

## Where to ask

| Kind | Where |
|------|--------|
| **Security vulnerability** | Private only — see [`SECURITY.md`](SECURITY.md) (GitHub Security Advisories preferred). Do **not** open a public issue. |
| **Bug / install failure** | [GitHub Issues](https://github.com/YuriOsipov/CoreEngine/issues) — use the bug or install templates when present. |
| **Question / design discussion** | GitHub Issues (label as question) until Discussions are enabled. |
| **Commercial / custom work** | Contact the maintainer via the GitHub profile of [YuriOsipov](https://github.com/YuriOsipov). No committed response time. |

## What “supported” means today

- Fixes land on the default branch (`main`).
- There is **no LTS channel** and no multi-version backport promise yet.
- Upgrade by following [`docs/upgrading.md`](docs/upgrading.md) (pull → migrate → rebuild/restart).
- Community answers are best-effort.

## Before you open an issue

1. Confirm BFF health: `http://localhost:4000/health`
2. Note which install path you used (lightweight / all-in-one / local npm)
3. Include OS, Docker / Node versions, and the failing command + log excerpt
4. Do **not** paste production secrets (`AUTH_JWT_SECRET`, DB passwords, IdP client secrets)

## Out of scope for “support”

- Building or hosting a customer’s production environment
- Guaranteeing parity with Salesforce / NocoBase / Twenty feature checklists
- Sharing hierarchies, SAML/SCIM, or in-product AI agents (scope: [README](README.md))
