# Ghost-Ark Formal Methods Notes

This document records the first formal-methods model stub for Ghost-Ark. It is a small TLA+ model intended to make one tenant-isolation boundary precise before broader implementation or refinement work exists.

## Current Model

The current model lives in `proofs/tla/TenantIsolation.tla`, with a tiny finite configuration in `proofs/tla/TenantIsolation.cfg`.

It models tenants, resources, resource ownership, access requests, allow decisions, deny decisions, and an append-only access log. The model is intentionally narrow so the invariant can be reviewed without importing unrelated AWS or AI-system behavior.

## Tenant Isolation Invariant

`NoCrossTenantAllow` states that no logged `allow` decision may exist when the requesting tenant does not own the requested resource.

Stated operationally: if the access log records an allow decision for tenant `t` and resource `r`, then the model's `owner[r]` value must equal `t`.

## What This Model Covers

- Tenants
- Resources
- Resource ownership
- Access requests
- Allow decisions
- Deny decisions
- An append-only access log

## What This Model Does Not Cover

This model does not cover AWS IAM evaluation, Cognito authentication, Lambda execution, DynamoDB consistency, KMS signing behavior, Bedrock invocation, OpenSearch indexing, S3 storage, Nitro Enclaves, zk proof generation, production receipt canonicalization, or policy-compiler semantics.

It also does not model concurrency beyond the single next-state transition, liveness, replay, key rotation, cross-region behavior, tenant namespace derivation, or refinement from TypeScript implementation traces.

## Non-Claims

This model does not prove the production Ghost-Ark implementation is correct.

This model does not prove AWS IAM, Cognito, Lambda, DynamoDB, KMS, Bedrock, OpenSearch, or S3 correctness.

This model does not prove model safety or model-output truthfulness.

This model has not been reported as model-checked unless a TLC output artifact is added.

This model is not a compliance certificate, AI safety certificate, production safety result, or claim that all tenant-isolation behavior has been formally verified.

## Next Formal-Methods Steps

- Explicit deny precedence
- Policy compilation
- Tenant namespace derivation
- Consent-gated memory access
- Concurrent receipt writes
- Refinement mapping between model actions and TypeScript enforcement traces
- TLC run instructions and checked output artifacts when model checking is actually performed
- Differential tests against AWS IAM policy simulation for supported policy fragments, run only with explicit approval for any live AWS dependency
