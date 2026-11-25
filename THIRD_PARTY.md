# Third-party licenses

CoreEngine itself is MIT. See [`LICENSE`](LICENSE).

This file lists components CoreEngine ships or tells you to run. License names are the `license` field in each package’s `package.json` at the version range in [`package.json`](package.json) and [`crm-bff/package.json`](crm-bff/package.json), or the license of the upstream project for images and the DocEngine sibling. Transitive npm packages are not listed. This is not legal advice.

## n8n — not part of CoreEngine

| Component | How it shows up | License |
|-----------|-----------------|--------|
| [n8n](https://github.com/n8n-io/n8n) `n8nio/n8n` | Optional Compose profile `automation` in `docker-compose.minimal.yml`. You pull the upstream image. It is not copied into the CoreEngine or BFF image, and `scripts/install-minimal.sh` / `install-minimal.ps1` refuse to start it. | [Sustainable Use License](https://github.com/n8n-io/n8n/blob/master/LICENSE.md) (not a permissive OSI license) |

n8n Community Edition is free for internal business use; hosted or resold use needs a separate agreement with n8n. That grant allows internal business use. It bars white-labeling n8n for customers, and hosting n8n and charging for access. Putting n8n inside a commercial product or appliance is outside the grant. Consulting on a customer’s own instance is a different matter: sell implementation and support, not “n8n access.”

Managed hosting or a true bundle needs a commercial agreement. n8n’s license contact is [license@n8n.io](mailto:license@n8n.io). Confirm the current terms with them.

## Activepieces — MIT alternative (not part of CoreEngine)

| Component | How it shows up | License |
|-----------|-----------------|--------|
| [Activepieces](https://github.com/activepieces/activepieces) `ghcr.io/activepieces/activepieces` | Started by `docker-compose.minimal.yml` (app + worker + dedicated Postgres/Redis, `restart: always`). You pull the upstream image. It is not copied into the CoreEngine or BFF image. The lightweight installer generates `AP_*` keys and starts it. Setup → Connections `config.target=activepieces` → `{ACTIVEPIECES_BASE_URL}/api/v1/webhooks/{flowId}`. | [MIT](https://github.com/activepieces/activepieces/blob/main/LICENSE) (community edition) |

Use Activepieces when you want an OSI-permissive orchestrator for the same BFF write-back pattern as n8n. Pack flow JSON under `docs/n8n/` remains n8n-native; rebuild equivalent Catch Webhook + HTTP steps in Activepieces (see [`docs/activepieces/README.md`](docs/activepieces/README.md)).

## Sibling repository

| Component | License |
|-----------|---------|
| [DocEngine](https://github.com/YuriiOsypov/docEngine) (`@docengine/editor`, `@docengine/engine`, `@docengine/pdf-renderer`) | MIT ([`LICENSE`](https://github.com/YuriiOsypov/docEngine/blob/main/LICENSE)) |

## Direct npm dependencies

### MIT

`vue`, `vue-router`, `vue-draggable-next`, `openvue`, `@openvue/themes`, `@openvue/auto-import-resolver`, `@openvue/openicons`, `tailwindcss`, `tailwindcss-primeui`, `@tailwindcss/vite`, `floating-vue`, `@visactor/vtable`, `@visactor/vue-vtable`, `chart.js`, `vite`, `@vitejs/plugin-vue`, `vitest`, `vue-tsc`, `unplugin-vue-components`, `@types/node`, `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/multipart`, `cors`, `graphql`, `graphql-yoga`, `isomorphic-dompurify`, `jose`, `pg`, `undici`, `tsx`, `@types/cors`, `@types/nodemailer`, `@types/pg`.

### MIT-0

`nodemailer`.

### Apache-2.0

`@daypilot/daypilot-lite-vue`, `@editorjs/editorjs`, `typescript`, `xlsx`.

### BSD-3-Clause

`quill`.

### BSD-2-Clause

`dotenv`.

### OFL-1.1

`@fontsource/inter` (Inter font).

### MPL-2.0 OR Apache-2.0

`dompurify`.

## Container images

| Image | Used by | License |
|-------|---------|---------|
| `node:22-bookworm-slim` | `Dockerfile`, `crm-bff/Dockerfile` | Node.js is MIT. The Debian base has its own package licenses. |
| `nginx:1.27-alpine` | `Dockerfile` (web) | nginx is BSD-2-Clause. Alpine packages have their own licenses. |
| `postgres:15-bookworm` | `docker-compose.minimal.yml` | [PostgreSQL License](https://www.postgresql.org/about/licence/) |
| Supabase self-host stack under [`docker/supabase/`](docker/supabase/) | root `docker-compose.yml` | Vendored from [supabase/supabase](https://github.com/supabase/supabase) (Apache-2.0) at the pin in [`docker/supabase/VENDOR.md`](docker/supabase/VENDOR.md). Postgres inside that stack remains under the PostgreSQL License. |
