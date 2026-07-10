# Guardrail Observation Model

## Purpose

This document defines a local research artifact for recording a bounded guardrail observation without storing prompt, completion, retrieval, or tool payloads in the artifact.

The contract separates four facts that are easy to conflate:

1. a guardrail emitted a recorded outcome;
2. an enforcement action was recorded;
3. content digests and pseudonymous scope were declared;
4. a receipt identifier and digest may have been declared as a reference.

None of those facts establishes that the guardrail was correct or that a live application emitted the artifact.

## Maturity

Under `docs/research/ASSURANCE_MATURITY_LADDER.md`, the artifact format is L2 schema-bound and its local validation and telemetry mapping primitives are L3 unit-tested.

Evidence:

- `schemas/research/guardrail-observation.schema.json`
- `packages/research-frontier/src/guardrailObservation.ts`
- `examples/research/guardrail-observations/`
- `tests/unit/research-frontier/guardrailObservation.test.ts`

Verification command:

```bash
npx vitest run tests/unit/research-frontier/guardrailObservation.test.ts
```

This maturity statement applies only to the local contract and fixtures. No runtime emitter, storage path, OpenTelemetry SDK configuration, cloud export, receipt mutation, or application integration is implemented by these artifacts.

## Observation Boundary

The v1 artifact records:

- observation time and pseudonymous request scope;
- guardrail identifier, version, and evaluation stage;
- recorded outcome and recorded enforcement action;
- bounded numeric scores and categorical findings;
- input and optional output digests;
- the privacy/export policy used by the producer;
- optional OpenTelemetry trace context;
- an explicitly unbound or declared-only receipt reference;
- explicit non-claims.

At least one score or finding is required. A score value must be inside its declared lower and upper bounds. Those checks establish shape and internal consistency only. They do not establish calibration quality, score meaning, threshold quality, or the correctness of a finding.

## Receipt Reference Model

`receipt_binding.status` has exactly two states:

| Status | Required values | Meaning |
| --- | --- | --- |
| `unbound` | `receipt_id: null`, `receipt_digest: null` | The observation declares no receipt reference. |
| `declared_reference` | non-empty `receipt_id`, SHA-256 `receipt_digest` | The producer declares the identifier and digest it intends to associate with the observation. |

There is deliberately no `verified`, `signed`, or `runtime_bound` status in v1.

The validator checks only the declared-reference shape. It does not load the receipt, recompute its digest, verify its signature, mutate an existing receipt, or prove that both artifacts came from one execution. The declared-reference example points at a checked-in sample receipt so a reviewer can inspect the intended linkage, but passing schema validation is not receipt verification.

A future integration that claims a stronger binding needs a separately versioned artifact, canonicalization rules, a verifier report, negative mismatch tests, and runtime evidence.

## Privacy And Redaction Contract

The observation is closed to undeclared properties. Its `content_evidence.raw_content_included` field is fixed to `false`, and the privacy block requires:

- `redaction_applied: true`;
- a redaction policy identifier and digest;
- at least one enumerated suppressed field;
- either `metadata_only` or `pseudonymous` classification.

The artifact can contain content digests and HMAC-derived scope identifiers. Those values are pseudonymous and correlatable; they are not anonymous. Key custody, rotation, retention, deletion, and re-identification risk remain outside this local schema.

The validator does not redact an arbitrary source payload. A producer must remove source content before constructing the object. Strict validation then rejects undeclared fields and rejects any object that sets `raw_content_included` to `true`.

Deliberately invalid fixtures exercise both raw-content and incomplete-receipt-reference rejection:

- `invalid-raw-content-flag.json`
- `invalid-incomplete-receipt-reference.json`

They contain synthetic values only.

## OpenTelemetry Attribute Mapping

`toGuardrailTelemetryAttributes` returns a plain attribute map. It does not depend on, configure, or send data through an OpenTelemetry SDK.

The mapping uses a project-owned namespace, not an external semantic convention:

| Observation field | Attribute |
| --- | --- |
| `schema_version` | `ghostark.schema_version` |
| `observation_id` | `ghostark.guardrail.observation_id` |
| `guardrail.guardrail_id` | `ghostark.guardrail.id` |
| `guardrail.guardrail_version` | `ghostark.guardrail.version` |
| `guardrail.evaluation_stage` | `ghostark.guardrail.evaluation_stage` |
| `result.outcome` | `ghostark.guardrail.outcome` |
| `result.action` | `ghostark.guardrail.action` |
| score count | `ghostark.guardrail.score_count` |
| finding count | `ghostark.guardrail.finding_count` |
| `privacy.classification` | `ghostark.privacy.classification` |
| `privacy.redaction_applied` | `ghostark.privacy.redaction_applied` |
| `receipt_binding.status` | `ghostark.receipt.binding_status` |

The default map excludes:

- tenant and request hashes;
- input and output digests;
- receipt identifiers and digests;
- score values and finding labels;
- suppressed content fields.

Callers may explicitly request the HMAC-derived tenant and request hashes with `includePseudonymousScope: true`. That option changes disclosure and cardinality risk and should be enabled only under a documented telemetry policy.

Trace and span identifiers remain trace context on the observation. The mapper does not duplicate them as attributes.

## Non-Claims

This local model does not demonstrate:

- live guardrail capture;
- Bedrock or another provider's guardrail behavior;
- application or receipt-pipeline integration;
- telemetry delivery, retention, access control, or deletion;
- successful redaction of an arbitrary runtime payload;
- guardrail accuracy, calibration, or safety;
- correct enforcement action;
- correct human review;
- regulatory or control conformance.

The bounded claim is: the checked-in schema, examples, validator, and telemetry mapper define and locally test a privacy-restricted guardrail observation shape.
