# Ghost-Ark Decision-Receipt Verifier Specification

Version **0.1.0** · normative for `conformance.json` suite_version 0.1.0

This document specifies a verifier for Ghost-Ark **decision receipts** completely enough to
implement one **without reading any Ghost-Ark source code**. The conformance suite in this
directory (`conformance.json`, `fixtures/`, `run-conformance.mjs`) lets such an implementation
check itself. RFC 2119 keywords (MUST, SHOULD, MAY) are used with their usual meaning.

**Why this document exists.** Ghost-Ark's experiment E14 delegated every cryptographic
primitive to OpenSSL and CPython and still could not close its independent-implementation gap,
because the *rule sequencing* — which checks run, over which fields, in what order — was
authored inside the repository, and every existing verifier implements it from the same
reading. This specification externalizes that sequencing. An implementation written from this
document alone, by somebody who has not read the reference verifiers, is the only thing that
can close the gap; this document merely makes such an implementation possible and checkable.

**Provenance warning, stated up front.** This specification was written by the Ghost-Ark
authors by reading their own reference implementation. If that implementation misreads its own
intent, this document reproduces the misreading. Conformance to this specification is
consistency, not correctness.

**Scope.** Decision receipts (`ghost.receipt.v1`) only. The receipt-record path
(`rct_`-prefixed, `ghost-ark.receipt.v1`) is out of scope for suite 0.1.0.

---

## 1. Data model

A **decision receipt** is a UTF-8 JSON document: a single top-level object with the fields in
§2. One field, `receipt_signature`, carries a base64url-encoded **signature envelope** (§5)
over the rest of the document.

Two values are derived from the receipt and must be recomputed by every verifier:

```
unsigned          = receipt with the receipt_signature member removed
identity_source   = unsigned with the receipt_id member removed
canonical_payload = canonicalize(unsigned)                        # §3
digest_sha256     = lowercase hex SHA-256 of UTF-8(canonical_payload)
receipt_id        = "grct_" + lowercase hex SHA-256 of UTF-8(canonicalize(identity_source))
```

`receipt_id` is *derived, not asserted*: it is inside the signed payload but computed over the
payload without it, so a signer can validly sign a receipt whose `receipt_id` is wrong. The
recomputation in the `receipt_id` check (§6) is what catches that.

## 2. Receipt schema (`schema` check)

`schema_version` MUST equal `"ghost.receipt.v1"`.

Required fields (all MUST be present):

| field | constraint |
|:---|:---|
| `schema_version` | exactly `"ghost.receipt.v1"` |
| `receipt_id` | string matching `^grct_[a-f0-9]{64}$` |
| `request_id`, `model_id`, `policy_version` | non-empty strings |
| `tenant_id_hash`, `user_id_hash`, `session_id_hash`, `input_digest`, `execution_context_hash` | string matching `^(sha256\|hmac-sha256):[a-f0-9]{64}$` |
| `timestamp` | string matching `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$` and parseable as a real date |
| `policy_hash` | string matching `^[a-f0-9]{64}$` |
| `execution_nonce` | string matching `^[A-Za-z0-9._:-]{8,256}$` |
| `decision_pre`, `decision_post` | one of `ALLOW`, `ALLOW_WITH_CONSTRAINTS`, `REDACT`, `REFUSE`, `ESCALATE` |
| `risk_score` | finite JSON number, `0 <= x <= 1` |
| `consent_state` | one of `granted`, `denied`, `missing`, `not_required` |
| `memory_written` | JSON boolean |
| `latency_ms` | integer, `0 <= x <= 2^53 - 1` |
| `cost_estimate_usd` | finite JSON number, `x >= 0` |
| `signature_alg` | `LOCAL_HMAC_SHA256_DEV_ONLY` or `KMS_SIGN_RSASSA_PSS_SHA_256` |
| `receipt_signature` | non-empty string |

Optional fields, with defaults that MUST be filled in **before** canonicalization when absent:

| field | default | constraint when present |
|:---|:---|:---|
| `retrieved_context_digests` | `[]` | array of strings each matching the digest pattern above |
| `action_taken` | `[]` | array of non-empty strings |
| `prev_receipt_hash` | `null` | `null` or string matching `^sha256:[a-f0-9]{64}$` |

Any field not listed above MUST cause rejection (`schema`). The committed fixtures carry every
optional field explicitly, so default-filling does not affect their identities; the rule
matters for receipts that omit them.

## 3. Canonical JSON

`canonicalize(value)` maps a parsed JSON value to a string:

- `null` → `null`; `true`/`false` → `true`/`false`.
- Strings → ECMAScript `JSON.stringify` semantics: wrapped in `"`, escaping exactly `"` as
  `\"`, `\` as `\\`, backspace `\b`, tab `\t`, newline `\n`, form feed `\f`, carriage return
  `\r`, and every other code point below U+0020 as `\u00XX` lowercase-hex-digits; all other
  code points — including all non-ASCII — are emitted literally, never `\u`-escaped.
- Numbers → ECMAScript Number-to-String (ECMA-262 `Number::toString`, the shortest decimal
  that round-trips the IEEE-754 double). Negative zero MUST serialize as `0`. Non-finite
  values MUST be rejected. *Portability note: other languages' shortest-float formatters
  differ from ECMAScript on integer-valued floats (`1.0`) and exponent thresholds. The
  committed fixtures use only values on which CPython's `json.dumps` agrees byte-for-byte
  with ECMAScript; Ghost-Ark's experiments E7 and E11 measure where such agreement breaks
  down in general. This suite cannot certify a canonicalizer outside its vectors.*
- Arrays → `[` + comma-joined canonicalized elements, order preserved, + `]`. No whitespace.
- Objects → `{` + comma-joined `"key":value` pairs + `}`, keys sorted by **UTF-16 code
  unit** order (ECMAScript `<` on strings — not code-point order, not locale order, not
  byte order of any UTF-8 encoding). Keys are escaped as strings. No whitespace.

Self-check before implementing anything else: for each entry in
`conformance.json → canonical_vectors.fixtures`, the SHA-256 of the committed
canonical-payload file's bytes equals `digest_sha256`, and your
`"grct_" + sha256hex(canonicalize(identity_source))` over the corresponding receipt equals
`receipt_id`.

## 4. Verifier options

A verifier accepts these options; the conformance adapter contract (§9) maps them to CLI
flags:

| option | meaning |
|:---|:---|
| `receipt` | path to the receipt JSON file (required) |
| `key` | path to an SPKI PEM RSA public key |
| `hmac-secret` | published dev-only HMAC test vector for `LOCAL_HMAC_SHA256_DEV_ONLY` |
| `expected-key-id` | expected signing-key identity |
| `tenant` + `identity-hmac-secret` | consumer tenant expectation (§8) |
| `pss-mode` | `digest-as-message` (default) or `digest-as-mhash` (§7.2) |

## 5. Signature envelope (`envelope` check)

`receipt_signature` MUST be **unpadded, canonical base64url** text (`[A-Za-z0-9_-]+`, length
mod 4 ≠ 1, and re-encoding the decoded bytes reproduces the input exactly). The decoded bytes
MUST be **strictly valid UTF-8** (reject unpaired surrogates / ill-formed sequences) and MUST
parse as a JSON object with **exactly** these five fields and no others:

| field | constraint |
|:---|:---|
| `schemaVersion` | exactly `"ghost.decision_receipt_signature.v1"` |
| `algorithm` | a supported `signature_alg` value, and MUST equal the receipt's `signature_alg` |
| `keyId` | non-empty string |
| `digestSha256` | string matching `^[a-f0-9]{64}$` |
| `signature` | non-empty **canonical standard base64** (`A-Za-z0-9+/` with correct `=` padding; re-encoding the decoded bytes reproduces the input) |

Additionally the decoded envelope text MUST itself be in canonical form:
`canonicalize(envelope) == decoded_text`. An envelope with reordered keys, insignificant
whitespace, or non-canonical escapes MUST be rejected even if its content is otherwise valid.

## 6. Checks, order, and short-circuit rules

A verifier performs named checks and reports each as passed or failed. The verdict is `PASS`
iff **every** reported check passed. The names below are normative; the conformance suite's
failing-check level matches on them.

Order and skip rules:

1. **`configuration`** — reject an unsupported `pss-mode` value before reading the receipt.
2. **`load`** — the receipt file reads and parses as JSON. On failure, report `load` (or
   `schema`, see §9) failed and STOP.
3. **`schema`** — §2, in full. On failure STOP: no identity is recomputed for a receipt that
   is not shaped like a receipt.
4. **`canonical_payload`** — canonicalization of `unsigned` completes (it cannot fail on
   input that survived `schema` via a standard JSON parse; the check guards host-object
   injection when a verifier is used as a library). On failure STOP.
5. **`receipt_id`** — recomputed id (§1) equals the receipt's `receipt_id`.
6. **`envelope`** — §5.
7. **`key_id`** — §6.1. Skipped (not reported) if the envelope failed to decode.
8. **`digest`** — envelope `digestSha256` equals the recomputed `digest_sha256`. Skipped if
   the envelope failed to decode.
9. **`signature`** — §7. MUST be reported failed — not silently skipped — when any earlier
   check failed; the reference implementations report it failed with a "skipped because an
   earlier check failed" detail. A signature MUST NOT be verified and reported passed on a
   receipt that failed any earlier check.
10. **`tenant_expectation`** — §8. Only reported when a tenant expectation was supplied.

`receipt_id`, `envelope`, `key_id`, and `digest` are all evaluated (none of them
short-circuits the others), so a report can show several of them failed at once.

### 6.1 `key_id`

For `KMS_SIGN_RSASSA_PSS_SHA_256` receipts, the envelope `keyId` MUST be an **immutable KMS
key identity**: either a bare key UUID (`8-4-4-4-12` hex, case-insensitive) or a key ARN
matching `arn:aws(-[a-z-]+)?:kms:<region>:<12 digits>:key/<uuid>`. Aliases (`alias/...`) MUST
be rejected — an alias is repointable, so it does not name a key. When `expected-key-id` is
supplied, two ARNs MUST match exactly; otherwise identities match iff their UUIDs match
case-insensitively.

For HMAC receipts, any non-empty `keyId` is acceptable; when `expected-key-id` is supplied it
MUST match exactly.

## 7. Signature verification (`signature` check)

### 7.1 `LOCAL_HMAC_SHA256_DEV_ONLY`

Compute HMAC-SHA-256 with the supplied secret over UTF-8(`canonical_payload`) and compare, in
constant time, against the decoded envelope `signature` bytes. If no secret was supplied the
check MUST fail closed. The secrets in this suite are **published dev-only test vectors**, not
credentials; this algorithm is never a production signing mode.

### 7.2 `KMS_SIGN_RSASSA_PSS_SHA_256`

RSASSA-PSS per RFC 8017 with SHA-256 as both message hash and MGF1 hash, salt length 32
bytes. The public key MUST be RSA, 2048–8192 bit modulus, odd public exponent ≥ 3. If no key
was supplied the check MUST fail closed.

Let `digest_bytes` be the 32 raw bytes of the recomputed `digest_sha256`. The two **digest
treatments** are distinct and NOT interchangeable:

| `pss-mode` | mHash passed to EMSA-PSS-VERIFY |
|:---|:---|
| `digest-as-message` (default) | `SHA-256(digest_bytes)` — the digest is treated as the message |
| `digest-as-mhash` | `digest_bytes` used directly — AWS KMS `MessageType=DIGEST` semantics |

A signature valid under one treatment MUST fail under the other; the suite asserts all four
directions across two committed vectors (`valid-kms-style-rsa` /
`pss-kms-style-rsa-wrong-treatment` and `valid-kms-digest-mode` /
`pss-kms-digest-mode-wrong-treatment`). A verifier MUST NOT try both treatments and accept
whichever verifies unless that behaviour is explicitly requested; the conformance cases pin
the mode per case.

## 8. Tenant expectation (`tenant_expectation` check)

When a consumer supplies `tenant` and `identity-hmac-secret`, the expected commitment is

```
"hmac-sha256:" + lowercase hex HMAC-SHA-256(identity-hmac-secret, UTF-8(tenant))
```

and MUST equal the receipt's `tenant_id_hash` (constant-time comparison). This is the
consumer-relational check: a byte-identical, cryptographically valid receipt from tenant A
MUST fail this check for a tenant-B consumer (case `MAL-014`), which is Ghost-Ark's
`Sound(C, Σ, P)` thesis in executable form. The vector in
`conformance.json → canonical_vectors.tenant_commitment` self-checks the derivation.

## 9. Reporting and the conformance adapter contract

A candidate verifier MUST exit `0` to accept and non-zero to reject. It SHOULD print a JSON
object to stdout containing:

- `checks`: array of `{ "name": string, "passed": boolean, "detail": string }`;
- `recomputed`: `{ "receipt_id": string, "digest_sha256": string }` when identity
  recomputation was reached.

When it does, the harness scores the failing-check and identity levels; when it does not,
those levels are reported `not-evaluated` — never assumed passed.

**Check-name latitude.** A receipt file that does not parse as JSON MAY be reported under
`load` or under `schema` (an implementation whose schema layer subsumes loading). No other
latitude exists: every other case's `expected_failing_checks` lists exactly one name, and a
conforming implementation MUST fail that check on that case. Rejecting for an *incidental*
reason — e.g. rejecting an unknown-field receipt via `receipt_id` mismatch because the extra
field also perturbs the identity — is verdict-correct but check-nonconformant, and the suite
reports it. (Ghost-Ark's own E14 third-party arm has exactly this property on `MAL-019`,
`MAL-023`, and `MAL-026`; it is recorded, not hidden.)

## 10. Running the suite

```
node run-conformance.mjs -- <command that runs your verifier>
```

Your command receives the §4 options appended per case. Exit `0` means: every verdict
matched, and no evaluated failing-check or identity comparison mismatched.

## 11. What conformance establishes, and what it does not

Passing establishes that your implementation reaches the declared verdicts on 36 fixtures
under declared options, fails the declared check on 30 rejection cases, and reproduces 4
committed canonical identities. It does **not** establish correctness outside the suite,
completeness of the rules, freedom from shared misreadings between this specification and
its reference implementations, or anything about the truth of any receipt. Two suite cases
(`MAL-029` backdated timestamp, `MAL-030` decision rewritten to ALLOW, both validly signed)
are expected to be **ACCEPTED**: signing proves signing authorization over a payload, not
that the payload is true, and no verifier rule claims to detect either. An implementation
produced from this specification under a recorded blindness protocol narrows Ghost-Ark's
open gap #10; the suite alone does not.
