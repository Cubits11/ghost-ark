# Threat Model

Ghost Ark assumes LLM applications are exposed to untrusted users, untrusted retrieval content, mistaken policy authors, and operational failures.

## Primary Assets

- Tenant-scoped policies and compiled policy hashes.
- Tenant, user, session, and request identity context.
- Memory records and memory-write decisions.
- Decision receipts and evidence receipts.
- KMS signing keys and local-dev signing secrets.
- Minimized audit metadata.

## Main Threats

- Client tries to supply `tenant_id`, `user_id`, or `session_id` in the request body or headers.
- Tenant A tries to read memory, retrieval results, receipts, claims, or policies for tenant B.
- Retrieved content contains an instruction that tries to become policy or developer authority.
- Model output contains PII or policy-violating content.
- Memory write path persists sensitive or restricted content without suppression or consent.
- Logs capture raw prompts, completions, memory, credentials, or request bodies.
- Receipt verifier accepts non-canonical JSON, missing policy hashes, or tampered fields.
- Hashes or signatures are described as proof of semantic correctness.

## Trust Boundaries

- Identity authority is API Gateway/Cognito/JWT/Lambda-authorizer context, not request text.
- The policy engine is deterministic code, not the model.
- Bedrock output is untrusted until post-model policy evaluation completes.
- Retrieved context is data, not instruction authority.
- DynamoDB TTL is a deletion backstop only; reads must filter expiration immediately.
- Local HMAC decision signing is for development tests only. Production decision receipts need KMS-backed signing.

## Fail-Closed Requirements

- Missing tenant identity blocks runtime access.
- Client-declared identity fields are rejected.
- Cross-tenant state access is denied.
- MEMORY_SUPPRESS prevents memory persistence.
- Restricted memory without explicit consent is not written.
- Consequential decisions must attempt receipt emission or return an auditable failure state.

## Non-Claims

This threat model does not prove AI safety, legal compliance, clinical or emotional safety, semantic correctness, complete tenant isolation, or production readiness.
