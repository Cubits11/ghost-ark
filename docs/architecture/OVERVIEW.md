# Ghost Ark Architecture Overview

Ghost Ark currently has two connected slices:

1. An AWS evidence and receipt-control plane for governed evidence records.
2. A governed invocation runtime slice for deterministic LLM policy decisions, tenant and taint-filtered retrieval context, Bedrock invocation adapters, memory-write gates, and decision receipts.

The repository now has a governed invocation runtime spine and a VERIFIED-RUNTIME-SPINE-v0.1-CANDIDATE API/CDK path. It is not release-ready as a production Bedrock enforcement runtime because live AWS validation, retrieval service integration, and operational evidence remain incomplete.

## Enforcement Lifecycle

The implemented runtime lifecycle is:

1. Normalize request.
2. Resolve verified identity from Cognito, JWT, or Lambda-authorizer context.
3. Reject client-declared tenant, user, or session authority.
4. Load tenant/user policy from a tenant-scoped repository. AWS mode disables default policy fallback unless `GHOST_ARK_ALLOW_DEFAULT_POLICY=true`.
5. Compile the policies into canonical deterministic policy objects.
6. Evaluate pre-retrieval and pre-model policy decisions.
7. Retrieve server-side context when a provider is configured, reject caller-supplied retrieval in AWS mode, and filter retrieved context by tenant and taint before prompt construction.
8. Invoke the configured model adapter only when pre-model policy allows.
9. Evaluate post-model output.
10. Gate memory writes by tier, consent, TTL, and suppression decision.
11. Emit minimized decision receipts for governed attempts.
12. Fail closed when receipt emission fails after model output.
13. Return the final response plus a receipt reference.

## Current Implemented Pieces

- Deterministic TypeScript policy schema, compiler, evaluator, and policy hash.
- Tenant-scoped in-memory and DynamoDB policy repository interfaces.
- Decision vocabulary: ALLOW, MODIFY, REDACT, REFUSE, SILENCE, ESCALATE, REQUIRE_CONSENT, MEMORY_SUPPRESS, RECEIPT_ONLY, HUMAN_REVIEW.
- Local and DynamoDB-shaped memory vault gates for KAPPA, SESSION, CONSTITUTION, AUDIT, and RESTRICTED tiers.
- Decision receipt schema with canonical JSON signing input, local-dev HMAC signer/verifier, KMS decision signer, KMS public-key verifier for `KMS_SIGN_RSASSA_PSS_SHA_256`, and hash-chain check.
- Retrieval firewall and provider interface that classify untrusted instruction text locally, reject cross-tenant context, and block strict-mode tainted retrieval before prompt construction.
- `governedInvoke` runtime that evaluates pre-retrieval, pre-model, post-model, and memory-write decisions around model invocation.
- Fake model invoker for deterministic tests and AWS Bedrock Runtime adapter for deployed use.
- `POST /tenants/{tenantSlug}/invoke` CDK route with Cognito authorization, Secrets Manager HMAC digest material, strict policy mode, model allowlist configuration, optional Bedrock Guardrails passthrough, and governed invoke alarms.
- API tenant identity derived from authorizer/JWT context, with body-declared tenant/user/session identifiers rejected for receipt creation.
- Redacted structured logging helper for prompt, completion, memory, raw body, and credential-like fields.

## Current Missing Pieces

- Live AWS validation of the governed invoke route, seeded policy, Secrets Manager HMAC digest secret, KMS signer/verifier, privacy vault table, alarms, and Bedrock call.
- Retrieval engine integration. The runtime has a provider interface plus no-op/static implementations, but no OpenSearch retrieval provider in this pass.
- Additional Bedrock model-family coverage beyond Anthropic Claude Messages, Amazon Titan Text, Cohere Command/Command R, and Mistral text-instruct styles.
- Release-ready IAM and operational evidence for the LLM runtime. Bedrock wildcard IAM is removed by default, but any explicit wildcard opt-in remains a release blocker until reviewed.

## Receipt Boundaries

Decision receipts prove a decision envelope existed, policy version/hash were recorded, selected digests were bound, decisions and memory/consent state were recorded, and the canonical unsigned envelope was signed. They do not prove semantic correctness, legal compliance, empirical truth, model safety, or absence of hidden context.
