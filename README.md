# Ghost Ark v50

Ghost Ark v50 is an AWS-native reference implementation for bounded governance receipts and deterministic enforcement primitives around LLM applications.

Cryptographic receipts, not safety claims: Ghost Ark verifies what was recorded, signed, and bounded by policy. It does not prove that an AI output is true, safe, ethical, compliant, or production-ready.

## Claim Discipline / Evidence Status

Ghost Ark is an AWS-runtime-validation candidate and certification-supporting evidence prototype. It is not certified, not production-hardened, and not a guarantee of AI safety.

Every public claim should map to local evidence, live AWS evidence, or an explicit limitation.

Governance references:

- [Claim/Evidence Matrix](docs/governance/claim-evidence-matrix.md)
- [Risk Register](docs/governance/risk-register.md)
- [External Reviewer Guide](docs/governance/external-reviewer-guide.md)
- [Claims Boundary](docs/release/CLAIMS_BOUNDARY.md)
- [Non-Claims](docs/compliance/non-claims.md)

## Spine Checklist

This checklist tracks evidence maturity, not personal goals or certification status.

| Item | Status | Spine | Evidence status |
|---|---:|---|---|
| Claim/evidence matrix | In progress | Spine A | Local documentation |
| Non-claim scanner | In progress | Spine A | Local enforcement |
| Receipt reproducibility harness | Complete | Spine B | Local tests and fixtures |
| Malicious receipt corpus | Complete | Spine B | Local negative tests |
| Live AWS evidence bundles | Not complete | Spine C | Requires bounded live AWS window |
| Key lifecycle and rotation protocol | Not complete | Spine D | Requires design and AWS validation |
| Guardrail observation schema | Not complete | Spine E | Requires schema and examples |
| CC-Framework correlation analysis | Not complete | Spine F | Requires integration evidence |
| Human review workflow | Not complete | Spine H | Requires workflow and evidence trail |
| Incident/failure reporting workflow | Not complete | Spine H | Requires workflow and examples |
| Risk register | In progress | Spine A | Local documentation |
| Control mapping to NIST AI RMF / ISO IEC 42001 | Not complete | Compliance spine | Requires mapping and review |
| External reviewer instructions | In progress | Spine A | Local documentation |
| Repeatable deployment evidence | Not complete | Spine C | Requires deploy, smoke, evidence, destroy |
| Independent verifier implementation | Partial | Spine B | Local verifier exists; independence boundary needs review |

A completed item means the repository contains evidence for that narrow item. It does not mean Ghost Ark is certified, production-ready, or safe for unsupervised deployment.

## Verify A Receipt In 60 Seconds

Ghost-Ark’s narrowest useful demo is local receipt verification: given a sample receipt, a public key, and an expected tenant, the verifier checks canonical receipt identity, canonical payload digest, tenant expectation, and RSA-PSS signature validity.

```bash
npm ci
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab
