# Live AWS evidence cleanup and closure

## Status and boundary

Cleanup is part of the bounded evidence window. A successful smoke followed by unconfirmed teardown is an `incomplete` lifecycle. This runbook documents future operator actions; it is not a record that any stack has been destroyed or any residual resource checked.

Use only the exact account, region, stage, stacks, and cleanup actions authorized during preflight. Destructive action outside that scope needs new human approval.

## 1. Enter cleanup before the deadline

Stop new smoke traffic and record the cleanup start time. If the window deadline is near, skip optional observations and prioritize teardown. Preserve failure and blocked statuses honestly.

Destroy only explicitly approved stacks. A Core Mode example is shown below; it is not authorization to run it:

```bash
npx cdk destroy \
  GhostArk-dev-Observatory \
  GhostArk-dev-Orchestration \
  GhostArk-dev-Api \
  -c stage=dev \
  -c enableSearch=false
```

If Search Mode was separately approved and deployed, use its reviewed dependency order and cleanup plan. Do not assume Core Mode teardown covers a Search domain, VPC, NAT Gateway, Elastic IP, or networking attachment.

Do not run ad hoc object deletion, key scheduling, table deletion, bucket emptying, user deletion, or log deletion unless that exact destructive action was approved. A resource that cannot be removed within authority is a residual or explicitly retained resource; it is not silently ignored.

## 2. Confirm stack outcomes

Use approved read-only CloudFormation inspection to confirm each scoped stack is absent after destroy. Record only sanitized summaries and observation times. A missing stack can be classified `ABSENT`; a stack still present is `RESIDUAL` unless the approval record explicitly permits retention.

Check every resource family synthesized or created by the scoped stacks, including as applicable:

- CloudFormation stacks;
- API Gateway APIs and stages;
- Lambda functions and event integrations;
- Cognito pools, clients, and temporary smoke users;
- DynamoDB tables and indexes;
- S3 buckets, objects, versioned objects, retention settings, and Object Lock configuration;
- KMS keys and aliases;
- Secrets Manager secrets;
- Step Functions state machines;
- Glue, Lake Formation, and Athena resources;
- CloudWatch alarms, log groups, dashboards, and SNS topics;
- Search domains, VPCs, subnets, NAT Gateways, Elastic IPs, and security groups if Search Mode was approved.

CDK removal policies, deletion protection, non-empty buckets, Object Lock retention, KMS deletion windows, and service-created logs can leave resources after stack deletion. The absence of a CloudFormation stack is therefore not sufficient cleanup evidence by itself.

For each resource family, record one of:

- `ABSENT` — inspected and not present;
- `RETAINED_APPROVED` — exact resource was approved for retention with owner and deletion date outside the public bundle;
- `RESIDUAL` — present without approved retention or not fully understood.

Put a sanitized explanation in `summary`. Do not place raw ARNs, account IDs, bucket names containing tenant data, secret names, endpoints, user identifiers, or object contents in the bundle.

## 3. Decide the cleanup status

Use `cleanup.status: CONFIRMED` only when:

- each scoped stack was inspected;
- every relevant resource family has an `ABSENT` or `RETAINED_APPROVED` check;
- there are no unapproved residual resources;
- the cleanup end time is recorded;
- the entire window stayed within `authorizedMinutes`.

Use `UNCONFIRMED` when inspection could not finish, identity or permissions changed, or a relevant resource family was not checked. Use `FAILED` when teardown failed or an unapproved residual resource remains. List residuals using sanitized descriptions and keep `lifecycleStatus: incomplete`.

The v1 validator rejects `lifecycleStatus: complete` when cleanup is unconfirmed, a resource check says `RESIDUAL`, `residualResources` is non-empty, a scoped stack lacks a successful deployment result, a scoped claim lacks an artifact-linked passing observation, or the authorized duration is exceeded.

## 4. Finalize and sanitize

After cleanup facts are recorded in the private candidate:

1. set `window.endedAt` to the actual closure time;
2. set `cleanup.startedAt`, `cleanup.endedAt`, `resourceChecks`, and `residualResources` from the bounded review;
3. set `lifecycleStatus` to `complete` only if every completion condition is true; otherwise leave it `incomplete`;
4. set `generatedAt` after the recorded window end;
5. run the sanitizer into a new review file;
6. validate that review file;
7. perform a second-person content and claim-boundary review.

```bash
npm run sanitize:evidence-bundle -- \
  --input "$PRIVATE_RAW_DIR/bundle-final-candidate.json" \
  --output "$PRIVATE_REVIEW_DIR/bundle.final.sanitized.json" \
  --redaction-file "$PRIVATE_RAW_DIR/redactions.json"

npm run validate:evidence-bundle -- "$PRIVATE_REVIEW_DIR/bundle.final.sanitized.json"
```

A validation pass checks schema, lifecycle consistency, window duration, scoped claim coverage, stack coverage, receipt-check consistency, and known leak patterns. It does not independently attest to AWS events or detect every possible sensitive value.

## 5. Preserve or discard

Do not move a bundle into `evidence/live-aws-validation/` without the repository's explicit human approval for checked-in live validation evidence. That directory is a protected evidence surface.

If approved for preservation:

- preserve only the final sanitized bundle and separately reviewed sanitized artifacts;
- verify every recorded artifact digest against the preserved file;
- do not preserve raw captures or the redaction file in the repository;
- identify the exact commit and review record;
- keep incomplete or failed windows labeled as such.

After the sanitized artifacts are accepted under the team's retention rules, securely remove private raw captures and redaction files using the operator's approved local-data procedure. Do not claim secure deletion merely from ordinary file removal.

## 6. Closure statement

A complete lifecycle supports only this bounded statement: the bundle records that its enumerated checks passed for the named source revision and scoped AWS window, with linked sanitized artifact digests and recorded cleanup confirmation.

An incomplete lifecycle can still document useful failures or blockers, but it is not repeatable deployment evidence and does not close `CLAIM-016` or `CLAIM-017`.
