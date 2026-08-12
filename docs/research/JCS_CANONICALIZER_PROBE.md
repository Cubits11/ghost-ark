# Probing RFC 8785 (JCS) implementations and the popular stable-stringify libraries

Tier: **supporting**. Measured 2026-08-12 on darwin/arm64, Apple M1 x8, node v22.22.3,
with `@ghost-ark/kernel-probe@0.1.0` installed from the npm registry.

This extends E11 to a class of target E11 did not cover. E11 probed four *general-purpose*
JSON pipelines — Rust `serde_json`, Ruby, CPython, jq — none of which claims to produce a
canonical form. The libraries below do make that claim: two implement RFC 8785 (JSON
Canonicalization Scheme), and three are the stable-stringify packages that JavaScript
projects reach for when they need a stable digest of an object.

That difference is the point. A collapse in `jq` is a property of a tool used for something
else. A collapse in a library whose stated job is canonical identity is a collapse in the
thing itself.

## Method

Each library was wrapped in the adapter the probe's contract requires — raw JSON on stdin,
the library's canonical form on stdout, non-zero exit for a refusal — and probed with the
31-class pre-registered alphabet:

```bash
npm install @ghost-ark/kernel-probe canonicalize json-canonicalize \
  fast-json-stable-stringify json-stable-stringify safe-stable-stringify
kernel-probe --command "node wrap.mjs <library>"
```

**A wrapper defect was caught and corrected before any result was recorded.** The first
adapter loaded `canonicalize` with `require()`; the package is ESM-only with a subpath
exports map, so every call threw and the probe scored **31 fail-closed, 0 sound** — a
library that appeared to refuse the entire alphabet. That is the vacuous arm E4 exists to
catch, and it is what an arm looks like when the harness, not the target, is broken. Fixed
with a dynamic import and re-run against a control document (`{"b":1,"a":2}` →
`{"a":2,"b":1}`) before the numbers below were taken.

## Results

| library | version | unintended kernel | over-discrimination | fail-closed | sound |
|:---|:---|---:|---:|---:|---:|
| `canonicalize` (JCS) | 4.0.0 | **5** | 1 | 1 | 22 |
| `json-canonicalize` (JCS) | 2.0.0 | **6** | 1 | 0 | 23 |
| `fast-json-stable-stringify` | 2.1.0 | **6** | 1 | 0 | 23 |
| `json-stable-stringify` | 1.3.0 | **6** | 1 | 0 | 23 |
| `safe-stable-stringify` | 2.5.0 | **6** | 1 | 0 | 23 |

Counts are a census over the whole 31-class alphabet, not a sample; no interval is attached.

## Finding 1 — duplicate keys collapse in all five, and the spec cannot see it

Every library gives these two documents one identity:

```
{"amount":1,"amount":2}   and   {"amount":2}
   both → {"amount":2}   → sha256 a2879a37ea1e0b89…
```

This is **not an implementation defect**, and reporting it as one would be wrong. RFC 8785
§3.1 states that "JSON objects MUST NOT exhibit duplicate property names" — but the same
section describes the input as *parsed* data, and §3.2.3 sorts property names of an already
parsed object. By the time a conforming implementation runs, `JSON.parse` has already
resolved the duplicate and discarded the evidence. The specification forbids a condition at
a layer where no conforming implementation can observe it.

That is the provenance-kernel result stated in a live standard rather than in our own code:
the kernel belongs to `parse ∘ canonicalize`, and a canonicalization spec that begins after
the parser inherits the parser's kernel whether or not it says so. See
[PROVENANCE_KERNEL_PROBLEM.md](./PROVENANCE_KERNEL_PROBLEM.md).

Who this matters to: any consumer that must distinguish "the sender transmitted contradictory
fields" from "the sender transmitted one field" — dispute resolution, audit of raw
transmitted bytes, or admission control over untrusted submissions. Consumers that only ever
see already-parsed values are unaffected, and for them this row is not a defect.

## Finding 2 — two implementations of the same RFC disagree, and one violates a MUST

RFC 8785 §3.2.2.3: *"Since Not a Number (NaN) and Infinity are not permitted in JSON,
occurrences of NaN or Infinity MUST cause a compliant JCS implementation to terminate with an
appropriate error."*

`1e400` and `1e401` are both syntactically valid JSON numbers (RFC 8259 puts no bound on the
exponent) that overflow to IEEE-754 `Infinity` when parsed into a double.

```
input {"v":1e400}  vs  {"v":1e401}

canonicalize       4.0.0 → throws Error                      (conforming: terminates)
json-canonicalize  2.0.0 → {"v":null}  for BOTH              → sha256 aae9e223dcdc02df
```

`json-canonicalize` does not terminate; it substitutes `null`, which is `JSON.stringify`'s
behaviour for a non-finite number. Two consequences, and the second is worse than the first:

1. It is a **MUST violation** against the RFC it names.
2. Because every overflowing literal maps to the same `null`, *all* numbers outside the
   double range receive one identity. `1e400`, `1e401`, and `1e999` are one document as far
   as the digest is concerned.

The same `{"v":null}` substitution occurs in `fast-json-stable-stringify`,
`json-stable-stringify`, and `safe-stable-stringify` — but those three make no RFC 8785
claim, so for them it is a documented-behaviour question rather than a conformance one.

**Two implementations of a canonicalization standard that produce different answers for the
same input is an interoperability defect in the exact property the standard exists to
provide.** A signature produced over one implementation's output cannot be re-verified
against the other's.

## Finding 3 — the 2^53 collapse is universal here, unlike in E11

All five give `9007199254740993` and `9007199254740992` one identity. E11's value was in
showing this collapse is *absent* from pipelines whose number model is not double-backed
(it is a property of the JavaScript number model, not of JSON), which narrowed the original
claim. Every library measured here runs on that model, so the collapse is universal across
this table and that is expected rather than newsworthy — recorded so the table is read
correctly.

## What this does not establish

The probe measures identifiability structure over one hand-curated adversarial alphabet
against one declared consumer set. It is not a random sample of JSON, not exhaustive, and
not a security review of any library named here. A collapse means only that a canonical form
identifies two documents that the declared consumer would distinguish; whether that matters
depends entirely on who consumes the identity, which is why every pathology ships with its
consumer rationale. Absence of a class here is not evidence of its absence in practice, and
a clean report would not be evidence of correctness.

Nothing here is a statement about the maintainers of these libraries, all of whom have
shipped useful, widely relied-upon software. Finding 1 in particular is a property of where
the specification starts, not of anyone's code.

## Reproducing

```bash
npm install -g @ghost-ark/kernel-probe
kernel-probe --command "<your canonicalizer>"
```

The adapter used for each library, and the exact reproduction for Findings 1–3, are given
above in full; no file from this repository is required.
