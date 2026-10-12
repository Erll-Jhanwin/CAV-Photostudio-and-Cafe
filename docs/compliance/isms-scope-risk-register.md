# ISMS scope and risk register

## Scope

The ISMS scope is the CAV Photo Studio & Cafe web frontend, Capacitor client, Django API, PostgreSQL/Supabase database, uploaded media, CI/CD pipeline, configured email/SMS/OCR/Google/payment processors, deployment accounts, and operational staff/admin processes. Physical studio and cafe operations are included where they handle system records.

## Asset classification

| Asset | Classification | Owner | Required control |
|---|---|---|---|
| User identity/contact/booking data | Confidential / personal data | Privacy owner | RBAC, cookie sessions, retention, export/delete workflow |
| Payment references and receipts | Confidential | Finance owner | Least privilege, upload validation, retention, audit trail |
| Inventory and supplier records | Internal | Operations owner | Staff/admin authorization, restricted API fields |
| Audit logs | Restricted / integrity critical | Security owner | Append-only controls, backup, review |
| Source, CI secrets, deployment configuration | Restricted | Engineering owner | Secret manager, rotation, branch protection, scanning |

## Initial risk register

| ID | Risk | Treatment implemented or required | Owner | Status |
|---|---|---|---|---|
| R-01 | Credential/token exposure | Removed committed demo/provider values; rotate provider keys and verify revocation | Engineering | Code fixed / manual rotation required |
| R-02 | Token theft through browser storage | HttpOnly SameSite cookies, refresh rotation, blacklist logout | Engineering | Implemented |
| R-03 | Privileged account takeover | Admin SMS OTP step-up using the registered mobile number | Security | Implemented / recovery review required |
| R-04 | Unauthorized inventory disclosure | Anonymous/customer serializer excludes stock, cost, recipes, suppliers | Operations | Implemented |
| R-05 | Audit history deletion | Read-only admin, manager guard, PostgreSQL trigger, reset preserves audit logs | Security | Implemented / migration deployment evidence required |
| R-06 | PII over-retention | Consent/request models, export endpoint, dry-run retention command | Privacy | Implemented / retention approval required |
| R-07 | Deployment drift | CI and container run `migrate --check` | Engineering | Implemented |
| R-08 | Accessibility barriers | Skip link, labels/errors, modal focus, carousel pause, 404 | Product | Implemented / assistive technology testing required |

Risk owners must accept residual risk, assign target dates, and attach review evidence each release.
