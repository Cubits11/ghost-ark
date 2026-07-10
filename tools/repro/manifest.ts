/**
 * Shared types and helpers for the receipt reproducibility fixtures and the
 * malicious receipt corpus.
 *
 * Claim boundary: these helpers reconstruct and verify decision receipts under
 * Ghost-Ark verifier rules only. They do not prove model safety, semantic
 * truth, compliance, or runtime integrity.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest,
  signedDecisionReceiptHash
} from "../../packages/enforcement-runtime/src/receipts/canonical";
import { SignedDecisionReceipt, UnsignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/schema";

export const REPRO_MANIFEST_SCHEMA_VERSION = "ghost.repro_manifest.v1";
export const REPRO_EXPECTED_DIGESTS_SCHEMA_VERSION = "ghost.repro_expected_digests.v1";
export const REPRO_REPORT_SCHEMA_VERSION = "ghost.repro_verification_report.v1";
export const CORPUS_MANIFEST_SCHEMA_VERSION = "ghost.malicious_receipt_corpus.v1";

export interface ReproFixtureIdentity {
  /** Dev-only published HMAC test vector. Not a credential. */
  hmac_secret_dev_only_test_vector: string;
  tenant_id: string;
  user_id: string;
  session_id: string;
}

export interface ReproFixtureSigning {
  key_id: string;
  /** Dev-only published HMAC test vector. Present only for LOCAL_HMAC fixtures. */
  hmac_secret_dev_only_test_vector?: string;
  /** SPKI PEM path, relative to the manifest directory. KMS-style fixtures only. */
  public_key_path?: string;
  note?: string;
}

export interface ReproFixtureReceiptInputs {
  request_id: string;
  timestamp: string;
  model_id: string;
  policy_version: string;
  policy_hash: string;
  /** Synthetic non-sensitive test vector. input_digest = sha256:<hex(text)>. */
  input_digest_source_text: string;
  /** Synthetic non-sensitive test vectors for retrieved_context_digests. */
  retrieved_context_digest_source_texts: string[];
  decision_pre: UnsignedDecisionReceipt["decision_pre"];
  decision_post: UnsignedDecisionReceipt["decision_post"];
  action_taken: string[];
  risk_score: number;
  consent_state: UnsignedDecisionReceipt["consent_state"];
  memory_written: boolean;
  latency_ms: number;
  cost_estimate_usd: number;
  /** Chains to another fixture's signed receipt hash, or null for a chain head. */
  prev_receipt_fixture_id: string | null;
  /** Synthetic text; execution_context_hash = sha256:<hex(text)>. Null = default dev boundary. */
  execution_context_source_text: string | null;
  /** Explicit nonce, or null for the default dev nonce. */
  execution_nonce: string | null;
}

export interface ReproFixturePaths {
  receipt: string;
  canonical_payload: string;
  signature_envelope: string;
}

export interface ReproFixture {
  fixture_id: string;
  description: string;
  signature_alg: SignedDecisionReceipt["signature_alg"];
  dev_only: boolean;
  regenerable: boolean;
  local_only_simulation: boolean;
  signing: ReproFixtureSigning;
  identity: ReproFixtureIdentity;
  receipt_inputs: ReproFixtureReceiptInputs;
  paths: ReproFixturePaths;
  non_claim: string;
}

export interface ReproManifest {
  schema_version: typeof REPRO_MANIFEST_SCHEMA_VERSION;
  updated_at: string;
  expected_digests_path: string;
  non_claim: string;
  fixtures: ReproFixture[];
}

export interface ExpectedFixtureDigests {
  receipt_id: string;
  digest_sha256: string;
  signed_receipt_hash: string;
}

export interface ExpectedDigests {
  schema_version: typeof REPRO_EXPECTED_DIGESTS_SCHEMA_VERSION;
  fixtures: Record<string, ExpectedFixtureDigests>;
}

export type CorpusVerifierKind = "hmac" | "kms_public_key" | "hmac_with_expected_tenant";

export interface CorpusAttack {
  attack_id: string;
  attack_name: string;
  base_fixture_id: string;
  verifier: CorpusVerifierKind;
  /** "malformed-json" fixtures are unparseable by design and must be rejected at load. Default: "receipt". */
  fixture_kind?: "receipt" | "malformed-json";
  mutated_field: string;
  mutation_description: string;
  receipt_path: string;
  expected_verdict: "reject" | "reject_by_consumer_tenant_expectation";
  /** Verifier check name expected to fail, or "tenant_expectation" for consumer-level rejection. */
  expected_rejection_phase: string;
  expected_error_substring: string | null;
  /** For cross-tenant expectation cases: the tenant id the consumer expects. */
  expected_tenant_id?: string;
  claim_boundary: string;
}

export interface CorpusManifest {
  schema_version: typeof CORPUS_MANIFEST_SCHEMA_VERSION;
  updated_at: string;
  /** Paths to base repro receipts, relative to the corpus manifest directory. */
  repro_manifest_path: string;
  non_claim: string;
  attacks: CorpusAttack[];
}

export interface ReportCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface FixtureReport {
  fixture_id: string;
  verdict: "PASS" | "FAIL";
  checks: ReportCheck[];
}

export interface ReproReport {
  schema_version: typeof REPRO_REPORT_SCHEMA_VERSION;
  manifest_path: string;
  verdict: "PASS" | "FAIL";
  fixture_count: number;
  fixtures: FixtureReport[];
  non_claim: string;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadReproManifest(path: string): { manifest: ReproManifest; baseDir: string } {
  const manifest = readJson<ReproManifest>(path);
  if (manifest.schema_version !== REPRO_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported repro manifest schema_version: ${String(manifest.schema_version)}`);
  }
  return { manifest, baseDir: dirname(resolve(path)) };
}

export function loadCorpusManifest(path: string): { manifest: CorpusManifest; baseDir: string } {
  const manifest = readJson<CorpusManifest>(path);
  if (manifest.schema_version !== CORPUS_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported corpus manifest schema_version: ${String(manifest.schema_version)}`);
  }
  return { manifest, baseDir: dirname(resolve(path)) };
}

export function fixtureById(manifest: ReproManifest, fixtureId: string): ReproFixture {
  const fixture = manifest.fixtures.find((entry) => entry.fixture_id === fixtureId);
  if (!fixture) {
    throw new Error(`Unknown fixture_id ${fixtureId} in repro manifest.`);
  }
  return fixture;
}

/**
 * Rebuild the unsigned decision receipt for a fixture from manifest-declared
 * inputs. Chained fixtures resolve prev_receipt_hash from the signed receipt
 * of the fixture they chain to, so callers must supply a resolver.
 */
export function rebuildUnsignedReceipt(
  fixture: ReproFixture,
  resolveSignedFixture: (fixtureId: string) => SignedDecisionReceipt
): UnsignedDecisionReceipt {
  const inputs = fixture.receipt_inputs;
  const identity = fixture.identity;

  const prevReceiptHash = inputs.prev_receipt_fixture_id
    ? signedDecisionReceiptHash(resolveSignedFixture(inputs.prev_receipt_fixture_id))
    : null;

  return buildUnsignedDecisionReceipt({
    request_id: inputs.request_id,
    tenant_id_hash: privateHmacDigest(identity.hmac_secret_dev_only_test_vector, identity.tenant_id),
    user_id_hash: privateHmacDigest(identity.hmac_secret_dev_only_test_vector, identity.user_id),
    session_id_hash: privateHmacDigest(identity.hmac_secret_dev_only_test_vector, identity.session_id),
    timestamp: inputs.timestamp,
    model_id: inputs.model_id,
    policy_version: inputs.policy_version,
    policy_hash: inputs.policy_hash,
    input_digest: publicSha256Digest(inputs.input_digest_source_text),
    retrieved_context_digests: inputs.retrieved_context_digest_source_texts.map((text) => publicSha256Digest(text)),
    decision_pre: inputs.decision_pre,
    decision_post: inputs.decision_post,
    action_taken: inputs.action_taken,
    risk_score: inputs.risk_score,
    consent_state: inputs.consent_state,
    memory_written: inputs.memory_written,
    latency_ms: inputs.latency_ms,
    cost_estimate_usd: inputs.cost_estimate_usd,
    prev_receipt_hash: prevReceiptHash,
    ...(inputs.execution_context_source_text !== null
      ? { execution_context_hash: publicSha256Digest(inputs.execution_context_source_text) }
      : {}),
    ...(inputs.execution_nonce !== null ? { execution_nonce: inputs.execution_nonce } : {}),
    signature_alg: fixture.signature_alg
  });
}

/** Pretty JSON with trailing newline for committed fixture files. */
export function fixtureFileJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Flip one lowercase hex character deterministically (0<->1, a<->b, etc.). */
export function flipHexChar(char: string): string {
  const value = Number.parseInt(char, 16);
  if (Number.isNaN(value)) {
    throw new Error(`Cannot flip non-hex character ${char}`);
  }
  return (value ^ 1).toString(16);
}

/** Flip the hex character at `index` within the hex portion after `prefix`. */
export function flipHexAt(value: string, prefix: string, index = 0): string {
  const position = prefix.length + index;
  return `${value.slice(0, position)}${flipHexChar(value[position] ?? "0")}${value.slice(position + 1)}`;
}
