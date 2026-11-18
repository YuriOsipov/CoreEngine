---
name: Install failure
about: Lightweight / Docker / provision install did not complete
title: 'Install: '
labels: install
assignees: ''
---

**Which install command**
Paste the exact command (e.g. `./scripts/install-minimal.sh` or the README Docker block).

**Where it failed**
- [ ] Env / passwords
- [ ] `docker compose up` / DB health
- [ ] Provision / migrate
- [ ] BFF start / `/health`
- [ ] Optional UI profile

**Environment**
- OS:
- Docker version:
- Compose file(s):

**Log excerpt**
Redact `POSTGRES_*`, `AUTH_JWT_SECRET`, IdP secrets.

**Already tried**
e.g. fresh volume, re-copied `.env.docker.example`, …
