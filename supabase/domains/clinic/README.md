# Clinic domain pack

Minimum Clinic app configuration on top of the Helix platform kernel.

## Includes

| Entity | Purpose |
|--------|---------|
| `patient` | Patients |
| `practitioner` | Clinicians |
| `visit` | Clinical visits |
| `appointment` | Scheduled appointments |

Roles: **Clinician**, **Reception** (full CRUD on pack entities). Administrator comes from the kernel.

## Apply

```powershell
npm run platform:provision -- -Domain clinic
```
