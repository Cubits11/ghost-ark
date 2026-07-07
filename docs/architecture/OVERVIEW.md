# Ghost Ark Architecture Overview

Ghost Ark currently has two connected slices:

1. An AWS evidence and receipt-control plane for governed evidence records.
2. A governed invocation runtime slice for deterministic LLM policy decisions, tenant and taint-filtered retrieval context, Bedrock invocation adapters, memory-write gates, and decision receipts.

The repository now has a complete local governed invocation path and AWS-ready API/CDK wiring. It is not yet release-ready as a production Bedrock enforcement runtime because live AWS validation, model-format breadth, KMS verification for decision receipts, and operational runbooks remain incomplete.

## Enforcement Lifecycle

The implemented runtime lifecycle is:

1. Normalize request.
2. Resolve verified identity from Cognito, JWT, or Lambda-authorizer context.
3. Reject client-declared tenant, user, or session authority.
4. Load tenant/user policy from a tenant-scoped repository, or an explicit conservative default policy.
5. Compile the policies into canonical deterministic policy objects.
6. Evaluate pre-retrieval and pre-model policy decisions.
7. Filter retrieved context by tenant and taint before prompt construction.
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
- Decision receipt schema with canonical JSON signing input, local-dev HMAC signer, KMS decision signer, verifier for local signatures, and hash-chain check.
- Retrieval firewall that rejects cross-tenant context and contains untrusted instruction taint before prompt construction.
- `governedInvoke` runtime that evaluates pre-retrieval, pre-model, post-model, and memory-write decisions around model invocation.
- Fake model invoker for deterministic tests and AWS Bedrock Runtime adapter for deployed use.
- `POST /tenants/{tenantSlug}/invoke` CDK route with Cognito authorization.
- API tenant identity derived from authorizer/JWT context, with body-declared tenant/user/session identifiers rejected for receipt creation.
- Redacted structured logging helper for prompt, completion, memory, raw body, and credential-like fields.

## Current Missing Pieces

- Bedrock Guardrails integration.
- KMS decision receipt verification. KMS signing is implemented; local verification remains the tested verifier path.
- Live AWS validation of the governed invoke route, KMS signer, policy table, privacy vault table, and Bedrock call.
- Retrieval engine integration. The runtime filters provided candidates but does not yet own a retrieval service.
- Bedrock adapter support beyond one Anthropic Messages path and one generic JSON path.
- Release-ready IAM and operational evidence for the LLM runtime.

## Receipt Boundaries

Decision receipts prove a decision envelope existed, policy version/hash were recorded, selected digests were bound, decisions and memory/consent state were recorded, and the canonical unsigned envelope was signed. They do not prove semantic correctness, legal compliance, empirical truth, model safety, or absence of hidden context.
