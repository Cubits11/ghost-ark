# Bounded live AWS evidence window

## Status and authorization boundary

This is an operator runbook for a future, explicitly authorized AWS validation window. It is not evidence that the window has been executed. Agents and reviewers running the local Spine C gate must not execute the live commands in this document.

Prerequisite: every item in `live-aws-evidence-preflight.md` is complete and a human has approved the exact live actions. Use an isolated development account and non-production stage only.

## 1. Start the clock and re-confirm scope

Record the UTC start time, approved end time, clean commit SHA, account hash, principal hash, region, stage, exact stack names, cost mode, and claim IDs. Re-confirm identity using the approved read-only identity command, keep the raw response in private temporary storage, and put only SHA-256 hashes of account and principal identifiers into the bundle.

If any value differs from the approval record, do not continue. Record the window as `incomplete` if a live AWS call already occurred, then follow the cleanup runbook.

The initial candidate must use:

```json
{
  "evidenceClassification": "live-aws-validation",
  "maturity": "L5-cloud-observed",
  "lifecycleStatus": "incomplete",
  "liveAwsCallsPerformed": true
}
```

`L5-cloud-observed` classifies the artifact type under the maturity ladder. It does not mean every scoped check passed. Only the per-check statuses and linked artifacts describe the observed result.

## 2. Deploy only the approved stacks

Use the exact context values reviewed during synthesis. A Core Mode example is shown below; it is not authorization to run it:

```bash
GHOST_ARK_ENABLE_SEARCH=false npx cdk deploy \
  GhostArk-dev-Api \
  GhostArk-dev-Orchestration \
  GhostArk-dev-Observatory \
  -c stage=dev \
  -c enableSearch=false
```

Do not use a wildcard stack selection. Do not enable Search Mode unless its domain, VPC, NAT, Elastic IP, additional duration, and teardown were separately approved.

For each approved stack, record:

- exact stack name;
- `CREATE_COMPLETE` or `UPDATE_COMPLETE`, or an honest failure status;
- observation time;
- SHA-256 digest of the locally reviewed synthesized template.

Do not copy raw CloudFormation events into the public bundle. On failure, stop smoke work, set `deployment.status` to `FAILED` or `BLOCKED`, keep the lifecycle `incomplete`, and begin cleanup.

## 3. Run only the approved smoke cases

Follow `docs/operations/runbooks/governed-invoke-validation.md` for the governed-invoke supervisor. Its live command calls API Gateway, Bedrock where configured, Secrets Manager, DynamoDB, and KMS and therefore must stay inside the approved window.

At minimum, the scope must name each claim being tested. Record one observation per claimed check:

| Claim | Minimum bounded observation |
|---|---|
| `CLAIM-006` | authenticated tenant path plus body-tenant override and cross-tenant rejection cases |
| `CLAIM-007` | one fetched receipt checked with the KMS decision-receipt verifier |
| `CLAIM-008` | one receipt write/read observation tied to a hashed receipt identifier |
| `CLAIM-010` | Object Lock configuration and retention behavior only if separately implemented and approved |
| `CLAIM-016` | exact deployment, smoke, capture, destroy, and confirmation lifecycle |
| `CLAIM-017` | start/end time within authorization plus the approved cost mode and cleanup result |

If a check was not run, use `NOT_RUN`. If permissions or missing configuration prevent it, use `BLOCKED`. If observed behavior differs from the expected bounded behavior, use `FAIL`. Never convert those statuses to `PASS` because another local test passed.

## 4. Link sanitized artifacts by digest

Keep raw reports private. For each observation, derive a sanitized report that excludes raw tokens, secrets, prompts, outputs, tenant labels, account IDs, principal ARNs, endpoints, user IDs, session IDs, and un-hashed receipt or key identifiers. Record the sanitized report's SHA-256 digest in `artifactDigests`.

For `CLAIM-007`, `receiptVerifications` must use hashed receipt and immutable key identifiers, name the verifier, record each check, and retain the policy or checkpoint hash when available. A `PASS` verdict requires every listed verifier check to pass.

Artifact digests establish a binding to the reviewed sanitized files. They do not establish that the underlying event happened independently of the operator's capture process.

## 5. Sanitize the candidate without exposing redaction values

Keep the raw candidate and optional redaction file outside the repository, then write a review copy to a separate path:

```bash
npm run sanitize:evidence-bundle -- \
  --input "$PRIVATE_RAW_DIR/bundle-candidate.json" \
  --output "$PRIVATE_REVIEW_DIR/bundle.sanitized.json" \
  --redaction-file "$PRIVATE_RAW_DIR/redactions.json"

npm run validate:evidence-bundle -- "$PRIVATE_REVIEW_DIR/bundle.sanitized.json"
```

The sanitizer:

- removes known raw sensitive fields;
- replaces caller-supplied exact values from the private redaction file;
- redacts recognizable account IDs, AWS ARNs, API endpoints, bearer tokens, JWTs, access keys, email addresses, and private-key markers;
- records only redacted paths, safe labels, and a digest of the raw candidate;
- fails closed if the result has unknown fields, violates lifecycle rules, or still matches a leak rule.

The sanitizer is not a substitute for human review. Inspect the sanitized file without printing the private source or redaction file. Do not overwrite the raw candidate in place.

## 6. Do not close the lifecycle before cleanup

During deployment and smoke capture, keep:

```json
{
  "lifecycleStatus": "incomplete",
  "cleanup": {
    "status": "UNCONFIRMED",
    "resourceChecks": [],
    "residualResources": []
  }
}
```

Proceed directly to `live-aws-evidence-cleanup.md`. A bundle may become `complete` only after every scoped stack has a successful deployment result, every scoped claim has a passing artifact-linked observation, required receipt checks pass, the window stays within its authorized duration, the source revision is clean, and cleanup is confirmed with no unapproved residual resources.

## Claim boundary

Allowed interpretation of a completed bundle: for the named commit, account hash, principal hash, region, stage, time window, stack set, claim set, and artifact digests, a reviewer can inspect the recorded bounded observations under the bundle and verifier rules.

The bundle does not establish AI safety, model safety, alignment, semantic correctness, empirical truth, legal compliance, production readiness, or behavior outside the recorded window.
