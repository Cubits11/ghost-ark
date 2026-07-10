# Transparency and Witness Model

## Implemented local boundary

Ghost-Ark has two related, local mechanisms:

- `ghost.receipt_checkpoint.v1` signs a deterministic Merkle root over tenant receipt-chain heads. `schemas/receipt-checkpoint.json` and `schemas/receipt-inclusion-proof.json` define the portable checkpoint and inclusion-proof shapes.
- The research witness model signs append-only checkpoint summaries and verifies consistency between two tree sizes. Its schemas are under `schemas/research/witness-*.schema.json`, and `npm run research:witness-bundle` produces a local test bundle.

The offline verifier checks receipt-chain inclusion with `--inclusion-proof` and checks research checkpoint consistency plus witness signatures with `--witness-checkpoint-consistency-proof`. These are local verifier mechanics. They do not establish that a checkpoint was publicly published, durably retained, or observed by an independent party.

## External witness roles

An execution-grade witness deployment separates four roles:

1. The log operator publishes ordered receipt commitments and signed checkpoints.
2. A monitor downloads every checkpoint, verifies append-only consistency, and archives the sequence.
3. A witness controls its own signing key and cosigns only checkpoints consistent with its prior view.
4. A relying verifier checks inclusion, checkpoint signature, witness key epoch, witness quorum policy, and consistency from a previously trusted checkpoint.

Independence is organizational and operational, not a field in a JSON document. A maintainer-controlled local witness remains a local fixture even if its signatures verify.

## Split-view and missing-context failures

The verifier must fail closed when a checkpoint root does not match an inclusion proof, tree sizes decrease, a consistency path is invalid, witness epochs do not cover the checkpoint time, a required witness is absent, or two checkpoints claim incompatible histories. Availability, gossip, quorum selection, and witness compromise recovery require an external operating policy that is not implemented here.

## Object Lock evidence boundary

An S3 bucket configuration or synthesized template is not retention evidence. A named live evidence bundle must include the bucket versioning/Object Lock configuration, object version ID, retention mode and retain-until timestamp, legal-hold state when relevant, checksums, principal context, and captured overwrite/delete denial results. Account IDs, tenant identifiers, request IDs, and credentials must be sanitized before publication.

No such live Object Lock bundle is added by this local implementation. Until one exists, the allowed statement is: Ghost-Ark defines local checkpoint, inclusion-proof, and witness-consistency verifier mechanics under Ghost-Ark rules.
