# Receipt Reproducibility Protocol

## Purpose

This protocol defines how a reviewer can replay Ghost-Ark decision-receipt fixtures from committed artifacts. The replay recomputes:

- `receipt_id`
- the canonical unsigned receipt payload
- the envelope `digestSha256`
- strict signature-envelope parsing and binding
- the supported signature verification result
- an optional tenant expectation

## Scope

The reproducibility corpus uses:

- `schema_version = ghost.receipt.v1`
- `receipt_id` prefix `grct_`
- snake-case receipt fields
- `receipt_signature` as unpadded base64url-encoded canonical JSON

The standalone Node verifier also accepts the older `ghost-ark.receipt.v1` record family used by `examples/sample-receipts/valid-receipt.json`, but that record family is not part of the decision-receipt reproducibility corpus.

## Claim Boundary

A passing report is local evidence that the selected artifact is internally consistent under the documented verifier rules.

It does not prove:

- model safety, alignment, or semantic truth
- regulatory compliance or certification
- production readiness
- live AWS execution
- KMS key custody or signing authorization
- runtime integrity or hardware attestation
- ledger completeness or the absence of withheld receipts
- complete resistance to malformed-receipt attacks

## Canonical JSON Contract

The receipt commitment uses deterministic JSON serialization:

- `null`, booleans, strings, and finite JSON numbers retain their JSON meaning
- negative zero serializes as `0`
- arrays preserve order and multiplicity
- object keys are sorted by ECMAScript UTF-16 lexicographic order
- no insignificant whitespace is emitted
- undefined values, sparse arrays, non-finite numbers, binary objects, and other non-JSON host values fail closed
- Unicode strings are not normalized; canonically equivalent NFC and NFD spellings remain different signed bytes

## Receipt Identity Algorithm

For a signed decision receipt:

1. Validate the exact `ghost.receipt.v1` field contract.
2. Remove `receipt_signature` to obtain the unsigned receipt.
3. Remove `receipt_id` from the unsigned receipt.
4. Canonicalize the remaining object.
5. Compute:

```text
receipt_id = "grct_" + sha256hex(canonicalize(unsigned_without_receipt_id))
```

The identity binds every unsigned receipt field except `receipt_id` itself.

## Digest Algorithm

For the same signed decision receipt:

1. Remove `receipt_signature`.
2. Canonicalize the unsigned receipt, including `receipt_id`.
3. Compute:

```text
digestSha256 = sha256hex(canonicalize(unsigned_receipt))
```

The result must equal `digestSha256` inside the decoded signature envelope.

## Signature Envelope

`receipt_signature` must decode to canonical JSON with exactly these fields:

```json
{
  "algorithm": "...",
  "digestSha256": "...",
  "keyId": "...",
  "schemaVersion": "ghost.decision_receipt_signature.v1",
  "signature": "..."
}
```

The verifier rejects unsupported versions or algorithms, missing or extra fields, malformed or alternate base64 encodings, mutable KMS aliases, key-identity mismatch, algorithm mismatch, and digest mismatch.

## Signature Treatments

Dev-only HMAC fixtures use a published test vector from the reproducibility manifest. The value is not a credential and the signing mode is not a production mode.

The committed KMS-style RSA fixture is a local simulation produced with a throwaway RSA key. It exercises RSA-PSS verification but is not AWS KMS evidence.

RSA-PSS verification has two explicit digest treatments:

- `digest-as-message`: the canonical-payload digest bytes are supplied as a message and hashed inside RSA-PSS. This matches the committed local Node-generated fixtures.
- `digest-as-mhash`: the canonical-payload digest is the RSA-PSS message hash. This matches AWS KMS `MessageType=DIGEST` semantics.

The modes are not interchangeable. `examples/reproducibility/pss-digest-mode/` is a local synthetic vector that must pass only with `digest-as-mhash`.

## Verification Paths

The repository has distinct local paths:

- `tools/repro/verify-repro-manifest.ts` uses the production TypeScript schema and verifier code to replay all declared fixtures.
- `verifiers/node/ghost_receipt_verify.mjs` imports Node built-ins only. It independently implements receipt/schema checks, canonicalization, envelope parsing, identity/digest recomputation, tenant expectation, key identity, HMAC verification, and RSA-PSS verification.
- `verifiers/python/ghost_receipt_verify.py` is a stdlib-only cross-language implementation used by additional differential tests when Python is available.

The standalone Node path is independent at the source-import boundary, not organizationally independent: it is maintained in the same repository and follows the same protocol. Agreement between these paths is local differential evidence, not an external audit or formal proof.

## Commands

Replay the production-path manifest:

```bash
npm run receipt:verify:repro
```

Run the standalone verifier directly:

```bash
npm run receipt:verify:independent
```

Replay the malicious corpus through the production verifier and compare it with the standalone verifier:

```bash
npm run receipt:verify:corpus
npm run receipt:verify:agreement
```

Run the complete local Spine B gate:

```bash
npm run spine:b
```

These commands perform no AWS calls and require no AWS credentials.

## Report Contract

For the same input and verifier options, reports must be deterministic except for operating-system text embedded in loader failures. A successful report includes:

- verifier report schema version
- verifier implementation path
- final `PASS` or `FAIL` verdict
- named checks with boolean results and details
- recomputed receipt identity and digest where parsing reached that phase
- RSA-PSS digest treatment
- explicit limitations and non-claims

## Current Local Evidence

The current Spine B artifacts include:

- a reproducibility manifest and committed expected digests
- three valid decision-receipt fixtures covering dev-only HMAC, chaining, and local KMS-style RSA-PSS
- a 26-case manifest-driven malicious corpus
- production-path reproducibility and adversarial tests
- a standalone Node verifier with no Ghost-Ark package imports
- standalone-versus-production agreement tests across the full malicious corpus
- local tests for both RSA-PSS digest treatments
- a separate Python implementation and cross-language tests when Python is available

This evidence remains local. It does not advance live AWS claims.

## Future Work

- validate the reproducibility and corpus manifests against versioned JSON Schemas
- add key-manifest epoch and retired/revoked-key adversarial cases
- add chain-fork, duplicate-id, checkpoint-root, and inclusion-proof cases
- export a minimal replay bundle for reviewers who do not run the full repository
- obtain external review of the protocol and standalone implementations
