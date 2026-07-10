import { createHash } from "crypto";
import fs from "fs";
import { describe, expect, it } from "vitest";
import sampleBundle from "../../../examples/evidence/live-aws-evidence-bundle.sample.json";
import {
  validateLiveAwsEvidenceBundle
} from "../../../tools/evidence/liveAwsEvidenceBundle";
import {
  sanitizeLiveAwsEvidenceBundle
} from "../../../tools/evidence/sanitize-live-aws-evidence";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function liveCompleteBundle(): Record<string, any> {
  const bundle = clone(sampleBundle) as Record<string, any>;
  bundle.bundleId = "ga-eb-live-test-window";
  bundle.evidenceClassification = "live-aws-validation";
  bundle.maturity = "L5-cloud-observed";
  bundle.lifecycleStatus = "complete";
  bundle.liveAwsCallsPerformed = true;
  bundle.generatedAt = "2026-07-09T12:21:00.000Z";
  bundle.sourceRevision = {
    repository: "ghost-ark",
    commitSha: "a".repeat(40),
    worktreeDirty: false
  };
  bundle.window = {
    startedAt: "2026-07-09T12:00:00.000Z",
    endedAt: "2026-07-09T12:20:00.000Z",
    authorizedMinutes: 30
  };
  bundle.scope.stage = "evidence-dev";
  bundle.scope.principalArnHash = digest("principal");
  bundle.preflight = {
    operatorAuthorizationRecorded: true,
    costBoundaryAcknowledged: true,
    searchModeReviewed: true,
    cleanupPlanReviewed: true,
    checks: [
      "local-validation",
      "claim-boundary-review",
      "cdk-synth",
      "identity-confirmation",
      "cost-review",
      "cleanup-plan"
    ].map((name) => ({
      name,
      status: "PASS",
      command: `reviewed ${name}`,
      observedAt: "2026-07-09T12:00:00.000Z",
      evidenceDigest: digest(`preflight-${name}`)
    }))
  };
  bundle.deployment = {
    status: "SUCCEEDED",
    startedAt: "2026-07-09T12:01:00.000Z",
    endedAt: "2026-07-09T12:06:00.000Z",
    stackResults: bundle.scope.stackNames.map((stackName: string, index: number) => ({
      stackName,
      status: "CREATE_COMPLETE",
      templateDigest: digest(`template-${index}`),
      observedAt: "2026-07-09T12:06:00.000Z"
    }))
  };
  bundle.observations = bundle.observations.map((observation: Record<string, unknown>, index: number) => ({
    ...observation,
    status: "PASS",
    observedAt: `2026-07-09T12:${String(7 + index).padStart(2, "0")}:00.000Z`,
    summary: `Bounded test observation ${index}; fixture used only by the local validator test.`,
    artifactDigests: [digest(`artifact-${index}`)]
  }));
  bundle.receiptVerifications = [
    {
      verifier: "KmsDecisionReceiptVerifier",
      receiptIdHash: digest("receipt-id"),
      keyIdHash: digest("key-id"),
      policyHash: digest("policy"),
      verdict: "PASS",
      checks: [
        { name: "schema", passed: true },
        { name: "canonical-digest", passed: true },
        { name: "signature", passed: true }
      ],
      observedAt: "2026-07-09T12:14:00.000Z"
    }
  ];
  bundle.cleanup = {
    status: "CONFIRMED",
    startedAt: "2026-07-09T12:15:00.000Z",
    endedAt: "2026-07-09T12:20:00.000Z",
    resourceChecks: [
      {
        resourceType: "CloudFormation stacks",
        status: "ABSENT",
        observedAt: "2026-07-09T12:20:00.000Z"
      }
    ],
    residualResources: []
  };
  bundle.sanitization.sanitizedAt = "2026-07-09T12:21:00.000Z";
  bundle.nonClaims = bundle.nonClaims.filter((entry: string) => !entry.startsWith("This fixture is synthetic"));
  return bundle;
}

describe("live AWS evidence bundle validation", () => {
  it("accepts the explicitly synthetic sample as L2 schema evidence", () => {
    const result = validateLiveAwsEvidenceBundle(sampleBundle);

    expect(result).toEqual({ valid: true, issues: [] });
    expect(sampleBundle.evidenceClassification).toBe("synthetic-non-live");
    expect(sampleBundle.liveAwsCallsPerformed).toBe(false);
    expect(sampleBundle.observations.every((observation) => observation.status === "NOT_RUN")).toBe(true);
  });

  it("rejects relabeling the synthetic fixture as live evidence", () => {
    const relabeled = clone(sampleBundle) as Record<string, unknown>;
    relabeled.evidenceClassification = "live-aws-validation";

    const result = validateLiveAwsEvidenceBundle(relabeled);

    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.path.includes("maturity") || entry.path.includes("sourceRevision"))).toBe(true);
  });

  it("rejects artifact digests attached to synthetic observations", () => {
    const overstated = clone(sampleBundle) as Record<string, any>;
    overstated.observations[0].artifactDigests = [digest("not-live-evidence")];

    const result = validateLiveAwsEvidenceBundle(overstated);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ keyword: "synthetic-boundary", path: "/observations/0/artifactDigests" })
    );
  });

  it("rejects evidence windows that exceed the recorded authorization", () => {
    const overlong = clone(sampleBundle);
    overlong.window.endedAt = "2026-07-09T12:30:00.000Z";
    overlong.generatedAt = "2026-07-09T12:31:00.000Z";

    const result = validateLiveAwsEvidenceBundle(overlong);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ keyword: "authorized-window" }));
  });

  it("rejects raw credentials, identities, endpoints, and sensitive fields", () => {
    const leaked = clone(sampleBundle) as Record<string, any>;
    leaked.scope.tenantId = "tenant-alpha";
    leaked.observations[0].summary =
      "Bearer abcdefghijklmnop for operator@example.test via https://abcd.execute-api.us-east-1.amazonaws.com/dev";

    const result = validateLiveAwsEvidenceBundle(leaked);

    expect(result.valid).toBe(false);
    expect(result.issues.some((entry) => entry.keyword === "sensitive-key")).toBe(true);
    expect(result.issues.filter((entry) => entry.keyword === "sensitive-value").length).toBeGreaterThanOrEqual(3);
  });

  it("does not let a leading redaction marker bypass the rest of a string", () => {
    const leaked = clone(sampleBundle) as Record<string, any>;
    leaked.observations[0].summary = "[REDACTED:tenant] was reviewed by operator@example.test.";

    const result = validateLiveAwsEvidenceBundle(leaked);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ keyword: "sensitive-value", path: "$.observations[0].summary" })
    );
  });

  it("accepts a complete live lifecycle shape only when deployment, claims, receipts, and cleanup are linked", () => {
    const complete = liveCompleteBundle();
    expect(validateLiveAwsEvidenceBundle(complete)).toEqual({ valid: true, issues: [] });

    complete.cleanup.status = "UNCONFIRMED";
    const incompleteCleanup = validateLiveAwsEvidenceBundle(complete);
    expect(incompleteCleanup.valid).toBe(false);
    expect(incompleteCleanup.issues.some((entry) => entry.path.includes("cleanup/status"))).toBe(true);
  });
});

describe("live AWS evidence bundle sanitizer", () => {
  it("removes forbidden fields, redacts caller-supplied values, and emits validated metadata", () => {
    const candidate = clone(sampleBundle) as Record<string, any>;
    candidate.scope.awsAccountId = "123456789012";
    candidate.scope.principalArn = "arn:aws:iam::123456789012:role/evidence-operator";
    candidate.observations[0].summary = "Tenant acme-lab was checked by operator@example.test.";
    const sourceBytes = Buffer.from(JSON.stringify(candidate), "utf8");

    const result = sanitizeLiveAwsEvidenceBundle(candidate, {
      sourceBytes,
      explicitRedactions: [{ label: "tenant", value: "acme-lab" }],
      sanitizedAt: "2026-07-09T12:06:00.000Z"
    });
    const text = JSON.stringify(result.bundle);

    expect(validateLiveAwsEvidenceBundle(result.bundle).valid).toBe(true);
    expect(text).not.toContain("123456789012");
    expect(text).not.toContain("arn:aws:");
    expect(text).not.toContain("acme-lab");
    expect(text).not.toContain("operator@example.test");
    expect(text).toContain("[REDACTED:tenant]");
    expect(text).toContain("[REDACTED:email]");
    expect(result.redactedPaths).toContain("$.scope.awsAccountId");
    expect(result.redactedPaths).toContain("$.scope.principalArn");
    expect(result.bundle.sanitization).toMatchObject({
      status: "PASS",
      leakScanStatus: "PASS",
      sourceDigest: digest(sourceBytes.toString("utf8"))
    });
  });

  it("fails closed when an unrecognized field remains after sanitization", () => {
    const candidate = clone(sampleBundle) as Record<string, any>;
    candidate.scope.unreviewedMetadata = true;

    expect(() =>
      sanitizeLiveAwsEvidenceBundle(candidate, {
        sourceBytes: fs.readFileSync("examples/evidence/live-aws-evidence-bundle.sample.json"),
        sanitizedAt: "2026-07-09T12:06:00.000Z"
      })
    ).toThrow(/additionalProperties/u);
  });
});
