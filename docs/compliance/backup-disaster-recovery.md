# Backup and disaster recovery

## Required production settings

- Database: automated encrypted backups with access restricted to the backend/database owners.
- Media: versioned backup of uploaded receipts/profile media with independent retention.
- Secrets/configuration: managed secret store backup or documented re-provisioning procedure; never back up plaintext secrets in source control.
- RPO: `[business owner to approve]`.
- RTO: `[business owner to approve]`.

## Test procedure

At least quarterly, restore a backup into an isolated environment, run migrations, execute API smoke tests, verify representative bookings/payments/audit records, record elapsed recovery time, and document discrepancies. Production data must not be restored to an unapproved developer environment.
