# ADR-0003: Policy Invariant Verification

Status: Accepted

## Context

Tenant namespace inputs are untrusted. The compiler must not emit IAM or Lake Formation policy documents that violate global isolation invariants, even if inputs contain traversal, wildcard, or JSON-injection payloads.

## Decision

The policy compiler validates both inputs and emitted policy ASTs. It rejects tenant slugs containing path traversal, wildcard characters, quotes, braces, shell-style interpolation, or encoded path separators.

Generated IAM documents must satisfy these invariants:

- No `Allow` statement may grant `Action: "*"`.
- `Resource: "*"` is allowed only for the bounded Glue, Athena, and Lake Formation read workflow.
- Receipt ledger grants may include `dynamodb:GetItem`, `dynamodb:Query`, and `dynamodb:PutItem`; they may never include update, delete, batch-write, PartiQL mutation, transaction-write, `dynamodb:*`, or `*`.
- Receipt ledger grants must constrain `dynamodb:LeadingKeys` to `${aws:PrincipalTag/slug}`.
- Tenant S3 object resources must use `/tenants/${aws:PrincipalTag/slug}/`.
- Tenant bucket listing must be constrained to the caller tenant prefix.

Generated Lake Formation plans must keep the consumer row filter exactly `tenant_slug = '<compiled-tenant-slug>'` and may not include destructive table permissions.

## Consequences

The compiler fails closed before returning a policy document. Security tests fuzz tenant namespaces and mutate emitted policy ASTs to prove invariant violations are detected independently from input validation.
