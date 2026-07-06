# Control Matrix

| Control | Mechanism | Evidence |
| --- | --- | --- |
| Tenant isolation | IAM principal tags, S3 prefixes, DynamoDB keys | Policy simulation output, CloudTrail |
| Regional boundary | Explicit deny outside approved regions | IAM policy document, simulator result |
| Data visibility | Lake Formation grants, row filters, LF-Tags | LF grant export, Athena query proof |
| Receipt integrity | Canonical JSON, SHA-256, KMS asymmetric signature | Receipt record, KMS key ID, verification result |
| Replayability | Raw evidence retention, lineage events, Step Functions replay | Replay execution, receipt supersession |
| Search disclosure | Tenant filter and index alias | Search request log, OpenSearch role mapping |
| Operational alerting | CloudWatch alarms, SNS notifications | Alarm history, incident runbook |
