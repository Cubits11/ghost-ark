
---

# Non-Claim Engineering

## Status

Research doctrine and implementation roadmap. This document describes a discipline for preventing unsupported assurance claims. It is not a certification claim, legal opinion, or completed formal method.

## One-sentence thesis

Non-Claim Engineering treats unsupported assurance language as a software defect.

## Core idea

Most engineering systems ask:

> *What does the system do?*

Non-Claim Engineering asks:

> *What must the system never allow people to say about it?*

In high-assurance AI infrastructure, unsupported claims are not cosmetic mistakes. They create governance risk.

### Examples of Unsafe Upgrades

| Unsupported wording | Safer bounded wording |
| --- | --- |
| Ghost-Ark proves AI safety. | Ghost-Ark records and verifies bounded execution evidence under explicit verifier rules. |
| Tenant isolation is proven. | Tenant-boundary logic has local tests; deployed API/Cognito/IAM isolation requires live AWS evidence. |
| KMS provenance is validated. | KMS signing support exists; live KMS sign/verify evidence is AWS-required. |
| Human oversight is operational. | Local human-review schemas and artifact linkage tests exist; operating workflow evidence is absent. |
| Compliance-ready. | Candidate evidence mapping exists; conformity assessment is not claimed. |

## Why non-claims matter

A receipt system can fail socially even when it succeeds cryptographically.

If people read a passing receipt as proof of safety, the receipt becomes dangerous. Non-claim boundaries prevent cryptographic artifacts from being promoted into semantic or organizational guarantees.

## Claim admissibility model

Let:

* `C` be a public claim.
* `E` be supporting evidence.
* `M` be evidence maturity.
* `L` be limitations.
* `F` be forbidden implications.

A claim is admissible **only if**:

1. `C` maps to a claim/evidence matrix row.
2. `E` exists and is reproducible.
3. `M` is sufficient for the wording used.
4. `C` includes or links to `L`.
5. `C` does not imply any element of `F`.
6. `C` does not upgrade local, synthetic, or schema-only evidence into live, operational, external, or certified evidence.

## Evidence maturity classes

| Class | Meaning | Example |
| --- | --- | --- |
| **NO_EVIDENCE** | No supporting artifact. | Placeholder future work. |
| **LOCAL_SCHEMA** | Schema and examples exist. | Guardrail observation schema. |
| **LOCAL_TESTED** | Local tests pass. | Receipt negative corpus. |
| **LOCAL_DIFFERENTIAL** | Two same-repo implementations agree. | Production verifier vs standalone Node verifier. |
| **AWS_SYNTH_ONLY** | CDK/Terraform templates synthesize. | DynamoDB table shape without deployment evidence. |
| **LIVE_OBSERVED** | Sanitized live bundle records a bounded event. | One deploy/smoke/destroy evidence window. |
| **EXTERNAL_REVIEWED** | Independent reviewer or implementation exists. | Third-party verifier report. |
| **CERTIFIED** | Formal certification/conformity assessment. | Not currently claimed. |

## Forbidden implication classes

| Class | Description |
| --- | --- |
| **SEMANTIC_SAFETY** | Claims about model truth, safety, harmlessness, alignment, or correctness. |
| **COMPLIANCE_CERTIFICATION** | Legal, regulatory, SOC 2, HIPAA, ISO, FedRAMP, or NIST certification claims. |
| **PRODUCTION_READINESS** | Claims that the system is production-ready or enterprise-ready. |
| **LIVE_AWS_PROOF_FROM_LOCAL** | Treating local tests, mocks, fixtures, or synth as live evidence. |
| **ORGANIZATIONAL_OPERATION** | Treating schemas as proof of staffed processes. |
| **EXTERNAL_INDEPENDENCE** | Treating same-repo implementation separation as external audit. |
| **COMPLETE_ATTACK_COVERAGE** | Treating a finite negative corpus as all possible attacks. |

## Non-claim engineering surfaces

A serious repository should enforce non-claims across:

* README
* Architecture docs
* Runbooks
* PR descriptions
* Release notes
* Evidence bundles
* CLI output
* Verifier reports
* Example fixtures
* Website copy
* Demo scripts
* Investor/recruiting one-pagers

## Current Ghost-Ark implementation pattern

Ghost-Ark already contains the early form of this discipline:

* Claim/evidence matrix
* Risk register
* External reviewer guide
* Release claims boundary
* Non-claims document
* Forbidden-claim scanner
* Schema-required non-claim text in evidence bundles
* Verifier non-claim output
* Synthetic/live boundary labels

## Future: claim typechecker

The next evolution is not just regex scanning. It is claim typechecking.

**Command:**

```bash
npm run claims:typecheck

```

**Expected behavior:**

```text
FAIL README.md:42
Claim: "KMS provenance validated"
Claim ID: CLAIM-007
Current maturity: AWS_REQUIRED
Problem: no preserved live KMS evidence bundle.
Suggested wording:
"The runtime supports KMS signing mode; live KMS provenance remains AWS-required."

```

### Claim object

A machine-readable claim should have this shape:

```json
{
  "claimId": "CLAIM-007",
  "surface": "README.md",
  "claimText": "Live KMS signing provenance is validated.",
  "claimType": "LIVE_AWS_PROVENANCE",
  "requiredEvidence": ["live-aws-evidence-bundle", "receipt-verification"],
  "currentEvidenceStatus": "AWS-required",
  "allowed": false,
  "reason": "No preserved complete live evidence bundle exists."
}

```

### Release gate rule

A release **must fail** if:

* Any public claim exceeds its evidence maturity.
* Any local artifact is presented as live evidence.
* Any synthetic artifact is presented as operational evidence.
* Any cryptographic receipt is presented as semantic truth.
* Any compliance mapping is presented as certification.
* Any verifier agreement is presented as external audit.
* Any human-review schema is presented as operating oversight.

## Research path

* **L1 — Scanner:** Regex-based forbidden-claim scanner.
* **L2 — Matrix:** Claims map to evidence rows, commands, and limitations.
* **L3 — Typed claims:** Public claims are represented as structured objects.
* **L4 — Claim typechecker:** Claims are checked against evidence maturity.
* **L5 — CI gate:** Unsupported assurance claims block pull requests.
* **L6 — External adoption:** Other repositories use the claim typechecker to avoid assurance overclaims.

## Proposed paper

> **Non-Claim Engineering:** > Executable Boundaries for AI Assurance Claims

## Closing statement

Non-Claim Engineering is how Ghost-Ark protects its own honesty. It makes unsupported confidence fail like a broken test.