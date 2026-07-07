# Tenant Boundary

Tenant isolation is release-blocking for Ghost Ark.

## Identity Source

Runtime code must derive tenant and user identity from verified server-side context:

- Cognito JWT claims.
- API Gateway authorizer context.
- Lambda authorizer context.

Runtime code must not trust tenant, user, or session identifiers supplied in the request body, prompt text, retrieval content, query text, or ad hoc developer headers.

## Current Code Behavior

- `apps/api/src/lib/auth.ts` extracts `tenantSlug` from JWT or authorizer context.
- The previous developer-header tenant fallback has been removed.
- `apps/api/src/handlers/createReceipt.ts` rejects body-declared `tenant_id`, `tenantId`, `tenantSlug`, `tenant_slug`, `user_id`, `userId`, `session_id`, and `sessionId`.
- `apps/api/src/handlers/invokeGoverned.ts` uses the same authenticated tenant context, requires a real authenticated subject, recursively rejects client-declared tenant/user/session authority, and passes verified identity into the runtime.
- `packages/enforcement-runtime/src/runtime/governedInvoke.ts` fails closed when the path tenant and authenticated tenant differ, when verified tenant/user identity is missing, or when the request body declares tenant/user/session authority.
- AWS governed invoke mode disables default policy fallback by default and requires an active tenant policy unless `GHOST_ARK_ALLOW_DEFAULT_POLICY=true` is explicitly set.
- Receipt and claim lookup handlers compare the authenticated tenant with the path tenant before repository access.
- Repository access patterns use `tenantSlug` as the DynamoDB partition key.
- Governed retrieval candidates are filtered by authenticated tenant before prompt construction. Cross-tenant candidates are rejected and trigger a fail-closed runtime result.
- AWS governed invoke mode rejects caller-supplied retrieval contexts and requires a server-side retrieval provider when retrieval is enabled. This pass adds the provider interface plus no-op/static implementations, not OpenSearch retrieval integration.
- Bedrock model IDs must be allowlisted before model invocation.

## Required Runtime Rules

- A tenant A principal cannot read tenant B memory.
- A tenant A principal cannot read tenant B receipts.
- A tenant A principal cannot load tenant B policy.
- Retrieval records tagged for tenant B cannot enter tenant A prompt context.
- Missing verified tenant identity blocks model invocation.
- Request body, prompt text, retrieval content, headers, query params, and model output are not tenant authority.

## Remaining Gaps

- Live AWS tests have not yet exercised the governed invoke route against Cognito, DynamoDB, KMS, and Bedrock.
- Retrieval service integration is not implemented; the runtime has a provider interface but no production retrieval provider in this pass.
- Bedrock wildcard IAM is removed by default. Any explicit wildcard opt-in remains a release blocker until reviewed.
- IAM least-privilege review remains incomplete for the full AWS substrate outside the governed invoke path.
