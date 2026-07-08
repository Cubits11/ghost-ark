# Live AWS Validation Evidence

This directory is the repository boundary for sanitized, reproducible outputs from supervised AWS validation runs.

Expected contents:

- `samples/`: redacted example report shapes for local tests and documentation.
- `<stage>/<UTC timestamp>/`: operator-committed live run artifacts from Bedrock, KMS, DynamoDB, OpenSearch, and API Gateway validation.
- `manifest.json`: optional per-run index containing command hashes, report hashes, account/region hashes, and reviewer sign-off.

Rules:

- Do not store bearer tokens, raw prompts, raw outputs, raw tenant slugs, raw user IDs, raw session IDs, secrets, raw retrieval text, raw HMAC secret IDs, or raw KMS key IDs.
- Store raw operational identifiers only as salted or private HMAC digests when a runbook explicitly requires correlation.
- Samples are not live evidence and must not be counted as production validation.

Non-claim:

Live validation evidence demonstrates that a bounded run satisfied the checks recorded in its reports. It does not prove AI safety, evidence truth, general AWS IAM correctness, absence of compromise, compliance, or production readiness outside the tested scope.
