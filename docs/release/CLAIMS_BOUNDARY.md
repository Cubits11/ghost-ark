# Release Claims Boundary

Ghost Ark may claim only behavior that is implemented, tested, and bounded by explicit non-claims.

## Current Permitted Claims

- The repository contains an AWS evidence and receipt-control plane for tenant-scoped evidence artifacts.
- Evidence receipts are canonicalized and can be KMS-signed in the existing receipt path.
- The repository contains a governed Bedrock invocation runtime that resolves tenant identity from verified auth context, loads tenant-scoped policy, evaluates deterministic pre/post model policy decisions, filters retrieval context by tenant and taint, gates memory writes, and emits minimized signed decision receipts for consequential LLM requests.
- The governed invoke route is wired in CDK as `POST /tenants/{tenantSlug}/invoke` with Cognito authorization, AWS-backed default modes, strict policy mode, Secrets Manager digest secret wiring, model allowlist configuration, KMS signing and verification support, and operational alarms.
- The governed invoke AWS path is an AWS-runtime-validation candidate. It is not production-ready until the live gates pass.
- Tenant identity for existing API receipt paths comes from JWT or authorizer context.
- Client-declared tenant, user, or session fields are rejected in receipt creation.
- Structured logging redacts prompt, completion, memory, raw body, and credential-like fields by default.

## Current Forbidden Claims

- Ghost Ark is enterprise-ready or production-ready.
- Ghost Ark proves AI safety.
- Ghost Ark provides legal compliance.
- Ghost Ark provides clinical, emotional, therapeutic, or mental-health safety.
- Cryptographic receipts prove semantic correctness.
- KMS signatures prove model output truth.
- Hashes prove safety.
- DynamoDB TTL gives immediate deletion.
- Bedrock Guardrails alone are sufficient policy enforcement.
- Passing the governed invoke smoke test proves AI safety, legal compliance, semantic correctness, or production readiness.

## Release Blockers For The North-Star Claim

- Run live AWS validation of the governed invoke route with Cognito, DynamoDB policy loading, DynamoDB privacy vault writes/reads, KMS decision signing, and Bedrock invocation.
- Run live KMS decision receipt verification against receipts emitted by the deployed invoke route.
- Integrate a retrieval service that supplies server-side context candidates.
- Broaden and harden Bedrock model request/response adapters.
- Keep Bedrock IAM scoped to allowlisted model ARNs. Any wildcard opt-in is a release blocker until removed or justified.
