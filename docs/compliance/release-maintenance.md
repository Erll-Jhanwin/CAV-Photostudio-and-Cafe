# Website lifecycle and maintenance

- Owner: `[assign product/website owner]`; technical owner: `[assign]`; privacy/security owners: `[assign]`.
- Every release uses the CI checks, migration check, review approval, staged smoke test, and rollback plan.
- Rollback means redeploying the last verified frontend/backend artifact and restoring only from an approved backup after incident review; do not use destructive database resets in production.
- Monitor authentication failures, OTP failures, 4xx/5xx rates, latency, background jobs, database health, storage, dependency alerts, and client runtime errors.
- Review dependencies monthly, rotate secrets after suspected exposure and at the approved interval, test backups quarterly, and review accessibility at each significant UI release.
- Maintain the change record, release identifier, test evidence, migration result, approver, monitoring result, and residual-risk decision.
