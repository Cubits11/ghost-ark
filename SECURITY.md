# Security Policy

Ghost-Ark is an experimental research artifact from the S2 Lab at Penn State's
College of Information Sciences and Technology. It is **unaudited** and must not
be used as the sole security boundary for a production system.

That sentence is not boilerplate. This repository publishes what it has measured
about its own limits — see [STATUS_AND_LIMITATIONS.md](./docs/artifact/STATUS_AND_LIMITATIONS.md)
for the open weaknesses and [CI_COVERAGE.md](./docs/artifact/CI_COVERAGE.md) for
what is and is not verified on every commit.

## Reporting a vulnerability

Report through **GitHub Security Advisories** on this repository
(Security → Advisories → Report a vulnerability). That channel is private until a
fix is published and is preferred over a public issue.

Please include the commit SHA, the command you ran, and the observed versus
expected verdict. A receipt or fixture that reproduces the finding is the single
most useful thing you can attach.

Expect an acknowledgement within 7 days. This is a research artifact maintained
alongside academic work, not a staffed product, so remediation time varies with
severity and is not contractually committed.

## What is in scope

Findings against the trust kernel are the ones that matter most:

- Receipt canonicalization and the strict-JSON admission scanner — any input pair
  that collides where it should not, or is admitted where it should fail closed.
- Signature envelope validation, key-manifest handling, and the KMS signing and
  verification paths.
- Tenant-boundary enforcement and cross-tenant retrieval.
- Replay, downgrade, nonce reuse, and chain-continuity defeats.
- Any case where a verifier returns PASS on a receipt it should reject, or where a
  documented guard can be made to report green while measuring nothing.

That last category is treated as a first-class vulnerability here, not a
documentation bug. A control that cannot fail is not a control.

## What is out of scope

- Semantic properties of model output — truthfulness, safety, alignment. Ghost-Ark
  makes no claim to evaluate these, and says so in [non-claims.md](./docs/compliance/non-claims.md).
- The quarantined directories (`dab/bench/`, `dab/gateway/UNBUILT_PROTOTYPES/`),
  which are marked non-evidential and excluded from every claim.
- Dev-only HMAC signing paths, which are documented as development-only.
- Findings that require an attacker who already holds the signing key.

## Boundaries

- No compliance certification is claimed, and none should be inferred.
- No bug bounty is offered. There is no monetary reward.
- Mock, schema-only, and research interfaces are not cryptographic proof of runtime
  behaviour, and are named `Mock*` so the distinction survives a code search.
- Live AWS deployment, Nitro attestation, KMS, and zero-knowledge claims require
  checked-in implementation evidence and explicit review before being asserted.

## Coordinated disclosure

Reporters are credited by name in the advisory unless they ask otherwise. If a
finding invalidates a published claim, the claim is retracted in
[EXPERIMENTS.md](./docs/research/EXPERIMENTS.md)'s retractions table with the
finding attributed — a withdrawn claim stays listed rather than being deleted.
