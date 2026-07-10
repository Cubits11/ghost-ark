import Ajv2020, { ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import liveAwsEvidenceBundleSchema from "../../schemas/live-aws-evidence-bundle.schema.json";

export const LIVE_AWS_EVIDENCE_BUNDLE_SCHEMA_VERSION = "ghost-ark.live-aws-evidence-bundle.v1" as const;

export interface EvidenceBundleValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export interface EvidenceBundleValidationResult {
  valid: boolean;
  issues: EvidenceBundleValidationIssue[];
}

interface EvidenceBundleShape {
  evidenceClassification?: unknown;
  lifecycleStatus?: unknown;
  liveAwsCallsPerformed?: unknown;
  generatedAt?: unknown;
  sourceRevision?: Record<string, unknown>;
  window?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  preflight?: Record<string, unknown>;
  deployment?: Record<string, unknown>;
  observations?: Array<Record<string, unknown>>;
  receiptVerifications?: Array<Record<string, unknown>>;
  cleanup?: Record<string, unknown>;
  sanitization?: Record<string, unknown>;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  strictTypes: false,
  validateFormats: true
});
addFormats(ajv);
const validateSchema = ajv.compile(liveAwsEvidenceBundleSchema);

const requiredCompletePreflightChecks = new Set([
  "local-validation",
  "claim-boundary-review",
  "cdk-synth",
  "identity-confirmation",
  "cost-review",
  "cleanup-plan"
]);

const sensitiveKeyNames = new Set([
  "authorization",
  "awsaccountid",
  "apiurl",
  "accesstoken",
  "credentials",
  "endpointurl",
  "idtoken",
  "password",
  "principalarn",
  "privatekey",
  "rawcapture",
  "rawoutput",
  "rawprompt",
  "refreshtoken",
  "requestbody",
  "responsebody",
  "secret",
  "sessionid",
  "tenantid",
  "tenantslug",
  "token",
  "userid"
]);

const sensitiveStringPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "aws-account-id", pattern: /\b\d{12}\b/gu },
  { label: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu },
  { label: "aws-arn", pattern: /\barn:(?:aws|aws-cn|aws-us-gov):[^\s"']+/giu },
  { label: "api-endpoint", pattern: /https:\/\/[^\s"']+\.execute-api\.[^\s"']+/giu },
  { label: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu },
  { label: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu },
  { label: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu },
  { label: "private-key", pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/giu }
];

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, keyword: string, message: string): EvidenceBundleValidationIssue {
  return { path, keyword, message };
}

function schemaIssues(errors: ErrorObject[] | null | undefined): EvidenceBundleValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath.length > 0 ? error.instancePath : "$",
    keyword: error.keyword,
    message: error.message ?? "schema validation failed"
  }));
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: unknown): Set<string> {
  if (!Array.isArray(values)) {
    return new Set();
  }
  return new Set(values.filter((value): value is string => typeof value === "string"));
}

function semanticIssues(bundle: EvidenceBundleShape): EvidenceBundleValidationIssue[] {
  const issues: EvidenceBundleValidationIssue[] = [];
  const window = bundle.window ?? {};
  const startedAt = timestamp(window.startedAt);
  const endedAt = timestamp(window.endedAt);
  const generatedAt = timestamp(bundle.generatedAt);
  const authorizedMinutes = typeof window.authorizedMinutes === "number" ? window.authorizedMinutes : null;

  if (startedAt !== null && endedAt !== null) {
    if (endedAt < startedAt) {
      issues.push(issue("/window/endedAt", "chronology", "must not precede window.startedAt"));
    } else if (authorizedMinutes !== null && endedAt - startedAt > authorizedMinutes * 60_000) {
      issues.push(issue("/window", "authorized-window", "recorded duration exceeds window.authorizedMinutes"));
    }
  }
  if (generatedAt !== null && endedAt !== null && generatedAt < endedAt) {
    issues.push(issue("/generatedAt", "chronology", "must not precede window.endedAt"));
  }

  const observationIds = new Set<string>();
  const scopedClaimIds = uniqueStrings(bundle.scope?.claimIds);
  for (const [index, observation] of (bundle.observations ?? []).entries()) {
    const observationId = observation.observationId;
    if (typeof observationId === "string") {
      if (observationIds.has(observationId)) {
        issues.push(issue(`/observations/${index}/observationId`, "unique-observation-id", "must be unique within the bundle"));
      }
      observationIds.add(observationId);
    }
    if (typeof observation.claimId === "string" && !scopedClaimIds.has(observation.claimId)) {
      issues.push(issue(`/observations/${index}/claimId`, "scope", "must be listed in scope.claimIds"));
    }
    const observedAt = timestamp(observation.observedAt);
    if (observedAt !== null && startedAt !== null && endedAt !== null && (observedAt < startedAt || observedAt > endedAt)) {
      issues.push(issue(`/observations/${index}/observedAt`, "window", "must fall within the recorded evidence window"));
    }
  }

  const scopeStackNames = uniqueStrings(bundle.scope?.stackNames);
  const stackResults = Array.isArray(bundle.deployment?.stackResults)
    ? (bundle.deployment?.stackResults as Array<Record<string, unknown>>)
    : [];
  for (const [index, stackResult] of stackResults.entries()) {
    if (typeof stackResult.stackName === "string" && !scopeStackNames.has(stackResult.stackName)) {
      issues.push(issue(`/deployment/stackResults/${index}/stackName`, "scope", "must be listed in scope.stackNames"));
    }
  }

  if (bundle.evidenceClassification === "synthetic-non-live") {
    for (const [index, observation] of (bundle.observations ?? []).entries()) {
      if (Array.isArray(observation.artifactDigests) && observation.artifactDigests.length > 0) {
        issues.push(
          issue(
            `/observations/${index}/artifactDigests`,
            "synthetic-boundary",
            "synthetic observations must not present artifact digests as captured evidence"
          )
        );
      }
    }
  }

  if (bundle.evidenceClassification === "live-aws-validation") {
    const stage = bundle.scope?.stage;
    if (typeof stage === "string" && /^(?:prod|production)(?:-|$)/iu.test(stage)) {
      issues.push(issue("/scope/stage", "environment-boundary", "v1 evidence windows are restricted to isolated non-production stages"));
    }
  }

  if (bundle.evidenceClassification === "live-aws-validation" && bundle.lifecycleStatus === "complete") {
    if (bundle.sourceRevision?.worktreeDirty !== false) {
      issues.push(issue("/sourceRevision/worktreeDirty", "reproducibility", "a complete live bundle must identify a clean source revision"));
    }

    const checks = Array.isArray(bundle.preflight?.checks)
      ? (bundle.preflight?.checks as Array<Record<string, unknown>>)
      : [];
    const seenChecks = new Set(checks.map((check) => check.name).filter((name): name is string => typeof name === "string"));
    for (const requiredCheck of requiredCompletePreflightChecks) {
      if (!seenChecks.has(requiredCheck)) {
        issues.push(issue("/preflight/checks", "complete-lifecycle", `missing required preflight check ${requiredCheck}`));
      }
    }

    for (const stackName of scopeStackNames) {
      const successfulResult = stackResults.some(
        (stackResult) =>
          stackResult.stackName === stackName &&
          (stackResult.status === "CREATE_COMPLETE" || stackResult.status === "UPDATE_COMPLETE")
      );
      if (!successfulResult) {
        issues.push(issue("/deployment/stackResults", "stack-coverage", `missing successful deployment result for ${stackName}`));
      }
    }

    for (const claimId of scopedClaimIds) {
      const matchingPass = (bundle.observations ?? []).some(
        (observation) => observation.claimId === claimId && observation.status === "PASS"
      );
      if (!matchingPass) {
        issues.push(issue("/observations", "claim-coverage", `complete lifecycle has no passing observation for ${claimId}`));
      }
    }
    for (const [index, observation] of (bundle.observations ?? []).entries()) {
      if (!Array.isArray(observation.artifactDigests) || observation.artifactDigests.length === 0) {
        issues.push(
          issue(
            `/observations/${index}/artifactDigests`,
            "evidence-link",
            "complete live observations must reference at least one sanitized artifact digest"
          )
        );
      }
    }
    for (const [verificationIndex, verification] of (bundle.receiptVerifications ?? []).entries()) {
      const checks = Array.isArray(verification.checks) ? (verification.checks as Array<Record<string, unknown>>) : [];
      if (checks.some((check) => check.passed !== true)) {
        issues.push(
          issue(
            `/receiptVerifications/${verificationIndex}/checks`,
            "receipt-verification",
            "a PASS receipt verdict cannot contain a failed or indeterminate check"
          )
        );
      }
    }
  }

  return issues;
}

function sensitiveMaterialIssues(value: unknown, path = "$", issues: EvidenceBundleValidationIssue[] = []): EvidenceBundleValidationIssue[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => sensitiveMaterialIssues(entry, `${path}[${index}]`, issues));
    return issues;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (sensitiveKeyNames.has(normalizedKey(key))) {
        issues.push(issue(childPath, "sensitive-key", `raw sensitive field ${key} is forbidden`));
      }
      sensitiveMaterialIssues(entry, childPath, issues);
    }
    return issues;
  }
  if (typeof value !== "string" || value.startsWith("[REDACTED:")) {
    return issues;
  }
  for (const { label, pattern } of sensitiveStringPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      issues.push(issue(path, "sensitive-value", `contains a raw ${label}`));
    }
  }
  return issues;
}

export function validateLiveAwsEvidenceBundle(value: unknown): EvidenceBundleValidationResult {
  const validSchema = validateSchema(value);
  const issues = [...schemaIssues(validateSchema.errors), ...sensitiveMaterialIssues(value)];
  if (validSchema && isRecord(value)) {
    issues.push(...semanticIssues(value as EvidenceBundleShape));
  }
  return { valid: issues.length === 0, issues };
}

export function formatEvidenceBundleValidationIssues(issues: EvidenceBundleValidationIssue[]): string {
  return issues.map((entry) => `${entry.path} [${entry.keyword}] ${entry.message}`).join("\n");
}

export function sensitiveEvidenceKey(key: string): boolean {
  return sensitiveKeyNames.has(normalizedKey(key));
}

export function redactKnownSensitivePatterns(value: string): { value: string; labels: string[] } {
  let redacted = value;
  const labels: string[] = [];
  for (const { label, pattern } of sensitiveStringPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(redacted)) {
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, `[REDACTED:${label}]`);
      labels.push(label);
    }
  }
  return { value: redacted, labels };
}
