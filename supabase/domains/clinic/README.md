# Clinic domain pack

Minimum Clinic app configuration on top of the CoreEngine platform kernel.

## Includes

| Entity | Purpose |
|--------|---------|
| `patient` | Patients |
| `practitioner` | Clinicians |
| `visit` | Clinical visits |
| `appointment` | Scheduled appointments |

Roles: **Clinician**, **Reception** (full CRUD on pack entities). Administrator comes from the kernel.

Navigation apps bind by role name: Reception → Appointments home; Clinician → Visits home. Compact card layouts ship for patient / visit / appointment; Clinician gets a notes-first visit form.

## Apply

```powershell
npm run platform:provision -- --domain clinic
```

## n8n reminders

`appointment.reminder_status` (Queued / Sent / Delivered / Failed) is for receptionist-facing delivery state.

```powershell
npm run registry:seed-n8n-automation-user
npm run registry:seed-n8n-pack-flows -- --pack=clinic
```

Import [`docs/n8n/send-appointment-reminder.workflow.json`](../../../docs/n8n/send-appointment-reminder.workflow.json) (webhook `ce-send_appointment_reminder`). Replace the stub Send node with WhatsApp/Telegram/email. See [`docs/n8n/README.md`](../../../docs/n8n/README.md).
