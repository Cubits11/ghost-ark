# Multi-Account Topology

The default v50 deployment starts single-account for speed, but every module is shaped for eventual producer, consumer, and control-plane separation.

## Accounts

- **Control plane:** APIs, receipt ledger, signing keys, tenant registry, policy compiler.
- **Producer data accounts:** raw evidence zones, CDC connectors, source-specific transforms.
- **Consumer analytics accounts:** Athena, notebooks, approved exports, observatory dashboards.
- **Security account:** audit aggregation, key policy review, anomaly detection.

## Promotion Path

1. Single-account dev.
2. Separate prod control and data account.
3. Producer/consumer Lake Formation sharing.
4. Organization-level SCP overlays and delegated administration.
5. Restricted or sovereign deployment profile.
