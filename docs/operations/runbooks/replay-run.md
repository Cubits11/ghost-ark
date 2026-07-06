# Replay Run

Use replay when a transform, crawler, indexer, or receipt emission step failed after raw evidence was accepted.

1. Identify the tenant slug and affected receipt or evidence object IDs.
2. Confirm raw evidence objects still exist.
3. Start `replay_pipeline.asl.json` with the tenant slug and receipt IDs.
4. Verify the Step Functions execution reaches `SUCCEEDED`.
5. Compare new receipt digests against prior failed or superseded entries.
6. Record the replay lineage event and incident reference.

Replay must not mutate raw evidence. It may produce a new curated dataset version and a superseding receipt.
