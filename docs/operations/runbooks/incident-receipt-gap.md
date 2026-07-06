# Incident: Receipt Gap

A receipt gap exists when evidence was accepted but no corresponding receipt or lineage event can be found.

1. Freeze cleanup policies for the affected tenant prefix.
2. Query raw evidence by ingest timestamp and source.
3. Query lineage events by source object URI.
4. Inspect Step Functions, Lambda, Glue, and CloudWatch logs.
5. Replay from raw evidence if the source object is intact.
6. If raw evidence is missing, open a governance incident and mark affected claims as disputed.
7. Export incident evidence pack and attach operator notes.
