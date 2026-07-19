# Ghost-Ark Google Cloud Security Model

## Claim Boundary (`AGENTS.md`)

Given receipt $R$, policy hash $H$, signature $S$, key manifest $K$, and checkpoint $C$, an external verifier can check the recorded binding under Ghost-Ark verifier rules.

## Security Controls

1. **Authentication**: Uses Google Application Default Credentials (ADC) or dedicated IAM service accounts with minimal necessary scope (`storage.objectAdmin` on specific buckets, `bigquery.dataEditor` on `ghost_ark_ledger`).
2. **Immutability & Object Locking**: Cloud Storage buckets enforce uniform bucket-level access and object versioning to prevent silent tampering or overwrites.
3. **Data Integrity**: Every uploaded evidence file is verified using SHA-256 digests prior to cataloging.
