# Policy Counterexample Engine

Phase 7 introduces a bounded counterexample verifier for generated tenant sandbox policies.

The counterexample engine is bounded to the Ghost-Ark generated tenant sandbox subset. It is not a complete model of AWS IAM, SCPs, permission boundaries, resource policies, or all service-specific condition keys.

## What It Does

- Builds a `TenantBoundaryModel` from a compiled tenant namespace.
- Enumerates modeled request states for tenant S3 prefixes, DynamoDB leading keys, receipt ledger actions, tenant workflow actions, and selected destructive probes.
- Evaluates the generated policy over the modeled subset.
- Reports any modeled request where the policy returns `Allow` and the declared tenant boundary returns `Deny`.
- Emits `ghost.policy_verification_report.v1` with policy digest, boundary digest, counterexamples, warnings, and non-claims.

## What It Does Not Claim

- Ghost-Ark does not formally verify AWS IAM.
- It does not model all AWS Organizations SCP behavior.
- It does not model all resource policies.
- It does not model all service-specific condition keys.
- It does not prove deployment safety.

## Modeled Scope

The model covers the Ghost-Ark tenant sandbox subset: S3 tenant prefixes and list prefixes, DynamoDB leading-key conditions, receipt ledger append-only constraints, selected Athena/Glue/Lake Formation workflow actions, IAM service-role pass-through, Lambda invocation, and logs write actions used by the generated policy.

Unsupported `NotAction`, `NotResource`, malformed conditions, and unsupported condition operators fail closed.

## CLI

```bash
npm run policy:counterexamples -- \
  --policy path/to/policy.json \
  --tenant tenant-a \
  --namespace path/to/namespace.json \
  --out reports/policy-counterexamples.json
```

The command exits `0` on `PASS` and `1` on `FAIL`.

## Adversarial Examples

- Add `dynamodb:DeleteItem` on the receipt table: `FAIL`.
- Remove `dynamodb:LeadingKeys`: `FAIL`.
- Add S3 access to another tenant prefix: `FAIL`.
- Use `NotAction` or `NotResource`: `FAIL`.
- Use an unsupported condition operator: `FAIL`.

A PASS verdict means no counterexample was found inside this bounded model. It is not full AWS IAM formal verification.
