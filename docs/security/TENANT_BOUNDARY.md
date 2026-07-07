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
- Receipt and claim lookup handlers compare the authenticated tenant with the path tenant before repository access.
- Repository access patterns use `tenantSlug` as the DynamoDB partition key.

## Required Runtime Rules

- A tenant A principal cannot read tenant B memory.
- A tenant A principal cannot read tenant B receipts.
- A tenant A principal cannot load tenant B policy.
- Retrieval records tagged for tenant B cannot enter tenant A prompt context.
- Missing verified tenant identity blocks model invocation.

## Remaining Gaps

- The Bedrock runtime wrapper does not exist yet.
- Policy storage and retrieval are not yet backed by a tenant-scoped repository.
- Memory vault storage is currently local test code, not DynamoDB.
- Search and retrieval taint are not wired into an LLM prompt builder.
- IAM least-privilege review remains incomplete for the full AWS substrate.
