Local Research Witness Bundle

Purpose

Ghost-Ark includes a local research witness bundle generator for demonstrating checkpoint consistency verification without live AWS resources, external services, or externally operated transparency infrastructure.

This document defines the local verifier boundary for research witness bundles.

The local witness bundle is a deterministic research fixture. It exists to demonstrate checkpoint consistency mechanics, witness signature verification mechanics, and verifier fail-closed behavior under Ghost-Ark verifier rules.

Maturity Classification

Current maturity under docs/research/ASSURANCE_MATURITY_LADDER.md:

L4: integration-tested subsystem

This classification applies only when the bundle generator, verifier, and integration tests pass locally.

It is not:

L6: reproducible external verification

unless a stable public bundle, pinned hashes, schemas, verification report, and reproduction command are published.

It is not:

L7: independent witness or auditor confirmation

unless independent witnesses or monitors outside the maintainer’s control sign or verify checkpoint material.

Generate Bundle

npm run research:witness-bundle -- --out examples/research/witness-bundle.local

This writes:

examples/research/witness-bundle.local/
  previous-witness-checkpoint.json
  new-witness-checkpoint.json
  consistency-proof.json
  witness-key-manifest.json
  README.md

The .local bundle path is intended for generated local output and should not be treated as a stable public release artifact.

Verify Bundle

Use this one-line command to avoid shell line-continuation mistakes:

node tools/ghost-verify.mjs --witness-checkpoint-consistency-proof examples/research/witness-bundle.local/consistency-proof.json --previous-witness-checkpoint examples/research/witness-bundle.local/previous-witness-checkpoint.json --new-witness-checkpoint examples/research/witness-bundle.local/new-witness-checkpoint.json --witness-key-manifest examples/research/witness-bundle.local/witness-key-manifest.json

Expected result:

VERDICT: PASS

What This Demonstrates

The local bundle demonstrates that Ghost-Ark can generate and verify a checkpoint consistency proof for a local research witness log under Ghost-Ark verifier rules.

The verifier checks:

* previous checkpoint shape
* new checkpoint shape
* consistency proof metadata
* consistency proof validity
* witness key manifest shape
* previous checkpoint witness signature
* new checkpoint witness signature

A passing result means the supplied local artifacts satisfy Ghost-Ark’s verifier rules for this fixture.

What This Does Not Demonstrate

The local bundle does not demonstrate:

* independent witness operation
* externally monitored transparency
* public checkpoint publication
* split-view resistance against a real operator
* long-term log availability
* live AWS receipt publication
* real production traffic evidence
* external auditor confirmation

Required Non-Claims

This is not:

* an independent witness network
* an externally operated transparency log
* a decentralized audit system
* evidence-truth verification
* an AI safety proof
* a compliance proof
* production-readiness evidence
* deployment-safety evidence

Local witness signatures demonstrate verifier mechanics only.

Independent witness confirmation requires external publication, independent monitors, witness-controlled keys, and consistency checks outside the maintainer’s direct control.

Upgrade Path

To upgrade this work beyond local research mechanics:

To L6: Reproducible External Verification

Required evidence:

* stable public witness bundle
* pinned artifact hashes
* public schemas
* verifier CLI command
* verification report
* no private database dependency
* no live Ghost-Ark server dependency

Allowed claim:

An external verifier can replay this published witness bundle and verify checkpoint consistency under Ghost-Ark verifier rules.

Forbidden claim:

Ghost-Ark has independent transparency.

To L7: Independent Witness or Auditor Confirmation

Required evidence:

* independent witness keys
* witness signatures over checkpoint roots
* monitor logs
* independently archived checkpoint copies
* consistency-check reports
* public witness identity or witness policy
* evidence that the maintainer does not control the witness set

Allowed claim:

Independent witnesses cosigned the named checkpoint root under the stated witness policy.

Forbidden claim:

Ghost-Ark has decentralized transparency.

unless multiple independent witnesses actually operate outside the maintainer’s control.

Reviewer Rule

If a README, release note, demo, diagram, paper, social post, or pitch references local witness bundles, it must say:

local research witness bundle

or:

local verifier mechanics

It must not say:

decentralized transparency

or:

independent witness network

unless L7 evidence exists.