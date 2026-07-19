# Ghost-Ark Google Cloud Threat Model

## Threat Vectors & Mitigations

| Threat | Risk Level | Mitigation Strategy |
| :--- | :--- | :--- |
| **Replay of Stale Receipt** | Medium | Checkpoint monotonicity enforcement via TLA+ proven invariants and timestamp validation |
| **Tampered Evidence Payload** | High | Mandatory SHA-256 pre-upload and post-download hash verification |
| **BigQuery Ingestion Outage** | Low | Exponential backoff retry handler with local buffer fallback |
| **Unauthenticated Cloud Access** | High | Strict IAM least-privilege policies and public access prevention |
