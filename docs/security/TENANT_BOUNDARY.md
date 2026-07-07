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
- Receipt and claim lookup handlers compare the authenticated tenant with the path tenant before repository access.
- Repository access patterns use `tenantSlug` as the DynamoDB partition key.
- Governed retrieval candidates are filtered by authenticated tenant before prompt construction. Cross-tenant candidates are rejected and trigger a fail-closed runtime result.

## Required Runtime Rules

- A tenant A principal cannot read tenant B memory.
- A tenant A principal cannot read tenant B receipts.
- A tenant A principal cannot load tenant B policy.
- Retrieval records tagged for tenant B cannot enter tenant A prompt context.
- Missing verified tenant identity blocks model invocation.
- Request body, prompt text, retrieval content, headers, query params, and model output are not tenant authority.

## Remaining Gaps

- Live AWS tests have not yet exercised the governed invoke route against Cognito, DynamoDB, KMS, and Bedrock.
- Retrieval service integration is not implemented; the runtime filters supplied candidates.
- KMS verification for decision receipts is not implemented in this pass.
- IAM least-privilege review remains incomplete for the full AWS substrate.
