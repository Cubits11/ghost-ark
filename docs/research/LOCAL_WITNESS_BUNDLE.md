# Local Research Witness Bundle

Ghost-Ark includes a local research witness bundle generator for demonstrating checkpoint consistency verification without live AWS resources, external services, or production transparency infrastructure.

## Generate Bundle

```bash
npm run research:witness-bundle -- --out examples/research/witness-bundle.local
```

This writes:

```text
examples/research/witness-bundle.local/
  previous-witness-checkpoint.json
  new-witness-checkpoint.json
  consistency-proof.json
  witness-key-manifest.json
  README.md
```

## Verify Bundle

Use this one-line command to avoid shell line-continuation mistakes:

```bash
node tools/ghost-verify.mjs --witness-checkpoint-consistency-proof examples/research/witness-bundle.local/consistency-proof.json --previous-witness-checkpoint examples/research/witness-bundle.local/previous-witness-checkpoint.json --new-witness-checkpoint examples/research/witness-bundle.local/new-witness-checkpoint.json --witness-key-manifest examples/research/witness-bundle.local/witness-key-manifest.json
```

Expected result:

```text
VERDICT: PASS
```

## What This Demonstrates

The local bundle demonstrates that Ghost-Ark can generate and verify a checkpoint consistency proof for a local research witness log under Ghost-Ark verifier rules.

The verifier checks:

- previous checkpoint shape
- new checkpoint shape
- consistency proof metadata
- consistency proof validity
- witness key manifest shape
- previous checkpoint witness signature
- new checkpoint witness signature

## Non-Claims

This is not:

- an independent witness network
- a production transparency log
- a decentralized audit system
- evidence truth verification
- AI safety proof
- compliance proof
- production readiness evidence
- deployment safety evidence

Local witness signatures demonstrate verifier mechanics only. Independent witness confirmation requires external publication, independent monitors, and witness-controlled keys.
