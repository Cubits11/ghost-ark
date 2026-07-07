# Ghost Ark Architecture Overview

Ghost Ark currently has two distinct slices:

1. An AWS evidence and receipt-control plane for governed evidence records.
2. A new local enforcement-runtime slice for deterministic LLM policy decisions, memory-write gates, and decision receipts.

The repository is not yet a complete Amazon Bedrock enforcement runtime. There is no production Bedrock invocation wrapper in this pass.

## Enforcement Lifecycle

The target runtime lifecycle is:

1. Normalize request.
2. Resolve verified identity from Cognito, JWT, or Lambda-authorizer context.
3. Reject client-declared tenant, user, or session authority.
4. Load organization and user constitutions.
5. Compile the policies into canonical deterministic policy objects.
6. Evaluate pre-retrieval and pre-model policy decisions.
7. Filter retrieved context by tenant and taint before prompt construction.
8. Invoke Bedrock only when policy allows.
9. Evaluate post-model output.
10. Gate memory writes by tier, consent, TTL, and suppression decision.
11. Attempt decision receipt emission for consequential decisions.
12. Store minimized receipt or auditable failure state.
13. Return the final response plus a receipt reference.

## Current Implemented Pieces

- Deterministic TypeScript policy schema, compiler, evaluator, and policy hash.
- Decision vocabulary: ALLOW, MODIFY, REDACT, REFUSE, SILENCE, ESCALATE, REQUIRE_CONSENT, MEMORY_SUPPRESS, RECEIPT_ONLY, HUMAN_REVIEW.
- Local memory vault gate for KAPPA, SESSION, CONSTITUTION, AUDIT, and RESTRICTED tiers.
- Decision receipt schema with canonical JSON signing input, local-dev HMAC signer, verifier, and hash-chain check.
- API tenant identity derived from authorizer/JWT context, with body-declared tenant/user/session identifiers rejected for receipt creation.
- Redacted structured logging helper for prompt, completion, memory, raw body, and credential-like fields.

## Current Missing Pieces

- Bedrock invocation wrapper.
- Bedrock Guardrails integration.
- Production KMS signer for decision receipts.
- DynamoDB-backed privacy vault.
- Retrieval engine with tenant and taint enforcement.
- Receipt emission wired into every consequential LLM path.
- Release-ready IAM and operational evidence for the LLM runtime.
