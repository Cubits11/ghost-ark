# Ghost-Ark Formal Methods Notes

Ghost-Ark's formal verification track begins with one core invariant:

> A tenant must never receive an allowed decision over a resource owned by another tenant.

The initial TLA+ model is deliberately small. It does not attempt to model the full AWS runtime, DynamoDB consistency, Cognito authentication, Bedrock invocation, or KMS signing behavior. Its purpose is to define the first model-checkable boundary for tenant isolation.

## Model Scope

The model currently represents:

- Tenants
- Resources
- Resource ownership
- Access requests
- Allow decisions
- Deny decisions
- An append-only access log

## Core Safety Invariant

`NoCrossTenantAllow` asserts that every logged allow decision must correspond to a resource owned by the requesting tenant.

## Non-Claims

This model does not prove that the production Ghost-Ark implementation is correct.

This model does not prove AWS IAM behavior.

This model does not prove Cognito, DynamoDB, Lambda, Bedrock, OpenSearch, S3, or KMS correctness.

This model does not prove AI safety or model-output safety.

## Research Direction

The next formal-methods step is to extend this model with:

- Explicit deny precedence
- Policy compilation
- Tenant namespace derivation
- Consent-gated memory access
- Concurrent receipt writes
- Differential tests against AWS IAM policy simulation for supported policy fragments
