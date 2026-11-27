# Compliance posture (not a certification)

CoreEngine is **self-hosted** software for SMB / mid-market ops. The **Clinic** and **Pricing** domain packs are vertical starters (scheduling, catalog, campaigns) — not a claim that a deployment is GDPR-, HIPAA-, or SOC 2–ready out of the box.

This page states what the product gives operators and what remains their responsibility. It is **not** legal advice and **not** a compliance attestation.

## What CoreEngine provides today

| Topic | Today |
|-------|--------|
| **Record audit** | Per-entity activity + revision tracking (mutations fail closed if the audit write fails). Record-page history UI. |
| **Admin config audit** | Append-only `config_audits` (DB triggers), GraphQL `configAudits`, Setup → **Config audit**. Covers entities, fields, roles, permissions, users, layouts, automations, org settings. |
| **Access control** | BFF-enforced auth (local JWT and/or OIDC), object ACL, field sensitivity (FLS), optional owner row security + Change Owner. See [`security.md`](./security.md). |
| **Data residency** | Operator chooses where Postgres / Supabase / files run. CoreEngine does not host customer data as a SaaS. |
| **Soft delete / purge** | Archive + scheduled `purge_archived_records` (operator-set `retentionDays`). Not a full legal-hold / e-discovery suite. |
| **Config as code** | Domain packs in git (`apply-pack` / `export-pack`) for reviewable schema/layout changes. |

## Operator / host responsibilities

| Topic | Expectation |
|-------|-------------|
| **Encryption in transit** | Terminate TLS at your reverse proxy / load balancer. |
| **Encryption at rest** | Configure on Postgres, disk, and object storage (Supabase / cloud volume encryption, etc.). The app does not add a second application-level crypto layer for all columns. |
| **Secrets** | Strong `AUTH_JWT_SECRET`, DB credentials, OIDC client secrets; no secrets in packs or client bundles. |
| **Retention & erasure** | Policy, backups, and purge job parameters are yours. Right-to-erasure / legal hold need process + host tooling beyond the in-app purge job. |
| **Identity & MFA** | Prefer OIDC + IdP MFA; disable local password login when SSO-only is required ([`oidc-sso.md`](./oidc-sso.md)). |
| **Backups** | Follow [`backup-restore.md`](./backup-restore.md); test restores. |
| **Assessments** | DPIA, BAA, SOC 2, HIPAA Security Rule controls, and similar are **deployment- and process-specific** — engage counsel / auditors for your stack. |

## Explicit non-claims

- No GDPR, HIPAA, ISO 27001, or SOC 2 **certification** of CoreEngine as a product.
- No built-in patient-consent, ePHI-specific, or cross-border transfer workflows beyond generic ACL / FLS / audit primitives.
- No SAML/SCIM, sharing hierarchies, or Teams object yet ([`features.md`](./features.md)).

For vulnerability reporting see [`SECURITY.md`](../SECURITY.md). For the security model see [`security.md`](./security.md).
