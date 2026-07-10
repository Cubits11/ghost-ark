# Live AWS evidence preflight

## Status and boundary

This runbook is a documented design for preparing a bounded Ghost-Ark AWS validation window. The schema, synthetic fixture, sanitizer, validator, tests, and CDK synthesis gate are local artifacts. They do not show that a deployment, AWS runtime check, receipt verification, or cleanup occurred.

Do not begin the live section without explicit human approval for the exact account, region, isolated development stage, stacks, cost mode, maximum duration, and teardown scope. The local preparation described here makes no AWS calls.

Related artifacts:

- `schemas/live-aws-evidence-bundle.schema.json`
- `examples/evidence/live-aws-evidence-bundle.sample.json` (synthetic and non-live)
- `tools/evidence/sanitize-live-aws-evidence.ts`
- `docs/operations/runbooks/live-aws-evidence-window.md`
- `docs/operations/runbooks/live-aws-evidence-cleanup.md`

## 1. Define the proposed window

Record a proposed window before requesting approval:

| Field | Required value |
|---|---|
| Source revision | Full commit SHA; worktree must be clean for a `complete` bundle |
| Account | Isolated development account; record only `sha256:<hex>` in the bundle |
| Principal | Named validation role; record only `sha256:<hex>` in the bundle |
| Region | One explicit region |
| Stage | Non-production stage |
| Cost mode | `core` by default; `search` needs separate cost approval |
| Stacks | Exact CloudFormation stack names |
| Claims tested | Subset of `CLAIM-006`, `007`, `008`, `010`, `016`, and `017` |
| Duration | Maximum authorized minutes, no more than the schema's 480-minute cap |
| Abort owner | Person empowered to stop validation and begin cleanup |
| Retained resources | Exact resources, retention reason, owner, and deletion date |

If the source is dirty, the account or principal is ambiguous, the stage is production-like, the teardown owner is absent, or cost scope is unknown, stop. Do not represent the window as authorized.

## 2. Run the credential-free gate

From the repository root:

```bash
npm ci
npm run spine:c:local
```

`spine:c:local` runs the preceding local spines, validates the synthetic evidence fixture, compiles the repository, and synthesizes CDK with Search Mode disabled. It does not deploy. If synthesis requests an AWS lookup or credentials, stop and treat the local gate as blocked rather than supplying credentials.

The focused commands are:

```bash
npm run validate:evidence-bundle
npm run infra:synth
```

Inspect the generated templates before any approval:

```bash
rg -n 'AWS::OpenSearchService::Domain|AWS::EC2::NatGateway|AWS::EC2::EIP' cdk.out
rg -n 'AWS::IAM::Policy|AWS::IAM::Role|AWS::KMS::Key|AWS::S3::Bucket|AWS::DynamoDB::Table' cdk.out
```

For Core Mode, the first search should produce no Search stack, OpenSearch domain, NAT Gateway, or search-related Elastic IP. The second search is a review aid, not an IAM or deployment proof.

Record hashes of the reviewed templates, not copies containing environment-specific values:

```bash
find cdk.out -maxdepth 1 -name '*.template.json' -print0 | sort -z | xargs -0 shasum -a 256
```

## 3. Review claim and cost boundaries

The operator and approver must read:

- `docs/governance/claim-evidence-matrix.md`
- `docs/governance/risk-register.md`
- `docs/operations/COST_MODES.md`
- `docs/operations/runbooks/governed-invoke-validation.md`

Required acknowledgements:

- local tests and CDK synthesis are not live AWS evidence;
- one bounded run does not generalize to other commits, accounts, regions, stages, policies, models, or times;
- receipts support checks of recorded bindings under Ghost-Ark verifier rules, not truth or model-output correctness;
- Core Mode still can incur cost;
- Search Mode is outside scope unless explicitly approved;
- cleanup confirmation is part of the evidence window, not an optional follow-up.

## 4. Prepare private capture storage

Raw captures can contain account IDs, principal ARNs, endpoints, request identifiers, tenant labels, receipt identifiers, and operator data. Keep them in an access-restricted temporary directory outside the repository. Set restrictive permissions before capture. Never place credentials, tokens, passwords, secret values, prompts, outputs, raw tenant labels, raw user or session IDs, or private keys in the candidate bundle.

Prepare two private files:

1. a raw bundle candidate following the schema except for the sanitizer-generated `sanitization` block;
2. an optional redaction JSON object mapping safe labels to exact values, such as `{ "tenant": "<raw value>" }`.

Do not pass raw redaction values as command-line arguments because shell history and process inspection can expose them.

## 5. Approval record

Approval must name:

- account hash and principal hash;
- region and stage;
- exact stacks and cost mode;
- start time and maximum minutes;
- permitted AWS commands and smoke cases;
- cleanup commands and residual-resource review;
- approver and operator, recorded outside the public bundle using the team's authorized system.

Set `preflight.operatorAuthorizationRecorded`, `costBoundaryAcknowledged`, `searchModeReviewed`, and `cleanupPlanReviewed` to `true` only after the corresponding review actually occurred. Store only a digest of any approval artifact in a preflight check. Do not embed personal data or ticket contents.

## 6. Abort conditions

Do not deploy, or stop the active window and move to cleanup, if any of these occurs:

- the local gate or claim scan fails;
- synthesized resources differ from the approved stack set;
- Search Mode or a high-cost resource appears without approval;
- identity, account, region, stage, or source revision differs from the approval;
- credentials or sensitive payloads appear in a capture;
- the maximum window would be exceeded;
- teardown cannot be performed immediately;
- an unexpected retained or residual resource appears.

An aborted run may be preserved only as `live-aws-validation` with `lifecycleStatus: incomplete` and honest `FAIL`, `BLOCKED`, or `NOT_RUN` statuses. Schema validity does not turn an incomplete run into successful deployment evidence.
