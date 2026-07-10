// Adversarial local mock data for the Ghost-Ark console preview.
//
// This is NOT a "happy path" fixture set. Each scenario reproduces one seam
// surfaced in the committee review, and pairs the raw component input with a
// truthful annotation of what the unmodified UI does *not* show. The console
// feature components are rendered exactly as shipped — the point is to observe
// whether they surface or mask each defect.
//
// Fixtures are typed against the real component prop interfaces below, so a
// fixture that drifts from the UI contract fails `tsc -p tsconfig.json`.

import type { ReceiptPanelProps } from "./pages/components/features/receipts/ReceiptPanel";
import type { LineageTraceNode, LineageTraceEdge } from "./pages/components/features/lineage/LineageTrace";
import type { GovernanceSummaryProps } from "./pages/components/features/governance/GovernanceSummary";
import type { ClaimRow } from "./pages/components/features/claims/ClaimsTable";

export type SeamSeverity = "core" | "high" | "medium" | "institutional";

export interface SeamAnnotation {
  id: "A" | "B" | "C" | "D";
  label: string;
  title: string;
  severity: SeamSeverity;
  /** What a viewer who trusts the console at face value concludes. */
  uiImpression: string;
  /** What is actually true — the seam the console does not surface. */
  groundTruth: string;
  citation: string;
}

/**
 * Verifier badges are the harness's own adversarial overlay, NOT part of the
 * shipped console. A `false` badge marks a check the console renders no signal
 * for. `null` means "not applicable to this fixture".
 */
export interface VerifierBadges {
  digestRecomputed: boolean | null;
  signatureValid: boolean | null;
  merklePathValid: boolean | null;
  keyIdImmutable: boolean | null;
  /** Was the key manifest that supplied the trust root itself authenticated? */
  manifestAuthenticated: boolean | null;
  /** Is the receipt inside a valid, non-revoked key epoch? */
  epochValid: boolean | null;
  /** Is the timestamp anchored to something other than the signer's own clock? */
  timeAnchored: boolean | null;
}

export interface EvidenceDoc {
  path: string;
  bytes: number;
  referencedBy: string;
}

export interface WilsonInterval {
  method: "wilson-score";
  confidenceLevel: 0.95;
  successes: number;
  total: number;
  lower: number;
  upper: number;
}

export interface Scenario {
  seam: SeamAnnotation;
  receipt: ReceiptPanelProps;
  lineage: { nodes: LineageTraceNode[]; edges: LineageTraceEdge[] };
  governance: GovernanceSummaryProps;
  claims: ClaimRow[];
  badges: VerifierBadges;
  /** Populated for the empty-surface fixture. */
  evidenceDocs?: EvidenceDoc[];
  /** Populated for the core-integrity fixture. */
  wilson?: WilsonInterval;
}

const IMMUTABLE_KEY = "arn:aws:kms:us-east-1:000000000000:key/1f2e3d4c-5b6a-7089-9a0b-1c2d3e4f5061";
const SUBSTITUTED_KEY = "arn:aws:kms:us-east-1:000000000000:key/deadbeef-0000-4000-8000-badc0ffee000";
const REVOKED_KEY = "arn:aws:kms:us-east-1:000000000000:key/aa11bb22-cc33-4d44-9e55-ff66aa77bb88";

// ---------------------------------------------------------------------------
// FIXTURE A — Core integrity path (the honest core).
// Valid canonicalized receipt, intact RFC 6962 Merkle inclusion, and a Wilson
// interval computed with the repository's own formula (z=1.959963984540054)
// for successes=3, total=40 -> [0.025841, 0.198637].
// ---------------------------------------------------------------------------
const fixtureA: Scenario = {
  seam: {
    id: "A",
    label: "Core integrity path",
    title: "Everything that should hold, holds",
    severity: "core",
    uiImpression: "A signed, canonicalized receipt with an intact lineage and evidenced claims.",
    groundTruth:
      "And it genuinely is: digest recomputes, signature verifies under an immutable KMS ARN, the Merkle inclusion path validates, and the failure-rate interval is a correct 95% Wilson score interval. This is the baseline the seams below deviate from.",
    citation: "packages/receipt-schema/src/hashCanonicalization.ts · packages/research-frontier/src/merkle.ts",
  },
  receipt: {
    receiptId: "rct_9f3c1a77e2b04d55a1c8e0d3f6b29a4471de88c0a2f5b6d7e8091a2b3c4d5e6f",
    digestSha256: "sha256:5d41402abc4b2a76b9719d911017c592f6a1b2c3d4e5f60718293a4b5c6d7e8f",
    keyId: IMMUTABLE_KEY,
    status: "issued",
    issuedAt: "2026-07-09T14:32:07Z",
  },
  lineage: {
    nodes: [
      { id: "n_input", label: "Input digest", kind: "input" },
      { id: "n_policy", label: "Policy v7 (hash bound)", kind: "policy" },
      { id: "n_model", label: "Allowlisted model invoke", kind: "model" },
      { id: "n_receipt", label: "Decision receipt", kind: "receipt" },
      { id: "n_checkpoint", label: "Merkle checkpoint #4182", kind: "checkpoint" },
    ],
    edges: [
      { from: "n_input", to: "n_policy", eventId: "lin_a1b2c3d4e5f6a7b8" },
      { from: "n_policy", to: "n_model", eventId: "lin_b2c3d4e5f6a7b8c9" },
      { from: "n_model", to: "n_receipt", eventId: "lin_c3d4e5f6a7b8c9d0" },
      { from: "n_receipt", to: "n_checkpoint", eventId: "lin_d4e5f6a7b8c9d0e1" },
    ],
  },
  governance: {
    tenantSlug: "acme-lab",
    lfTags: { classification: "synthetic", zone: "curated", retention: "365d-governance" },
    rowFilter: "tenant_id_hash = current_tenant()",
    columnRestrictions: ["user_id_hash", "session_id_hash"],
  },
  claims: [
    {
      claimId: "clm_2f7a1c9e",
      statement: "Receipt binds policy hash to the canonical payload under Ghost-Ark verifier rules.",
      state: "evidenced",
      receiptCount: 3,
      updatedAt: "2026-07-09T14:33:10Z",
    },
  ],
  badges: {
    digestRecomputed: true,
    signatureValid: true,
    merklePathValid: true,
    keyIdImmutable: true,
    manifestAuthenticated: true,
    epochValid: true,
    timeAnchored: true,
  },
  wilson: {
    method: "wilson-score",
    confidenceLevel: 0.95,
    successes: 3,
    total: 40,
    lower: 0.025841,
    upper: 0.198637,
  },
};

// ---------------------------------------------------------------------------
// FIXTURE B — Broken trust root.
// Signature verifies locally, but the verifying public key came from an
// unauthenticated key manifest (no signature, no chain, no monotonic serial).
// Substitute the manifest -> substitute the trust root -> every local check,
// including the signature, passes for a forged receipt.
// ---------------------------------------------------------------------------
const fixtureB: Scenario = {
  seam: {
    id: "B",
    label: "Broken trust root",
    title: "Local signature PASS over a substituted key",
    severity: "high",
    uiImpression: "status: issued — a normally signed receipt, indistinguishable from Fixture A.",
    groundTruth:
      "The signature does verify — against a public key lifted from an unauthenticated manifest. The manifest carries publicKeyPem but is a bare trusted file: no signature over it, no hash chain, no monotonic serial. Swap the manifest and any forged receipt passes every local check. The console shows 'issued' and offers no signal that the trust root was never authenticated.",
    citation: "packages/enforcement-runtime/src/receipts/keyManifest.ts:68",
  },
  receipt: {
    receiptId: "rct_c0ffee11deadbeef2222333344445555666677778888999900aabbccddeeff01",
    digestSha256: "sha256:aa00bb11cc22dd33ee44ff5566778899a0b1c2d3e4f50617f8091a2b3c4d5e6f",
    keyId: SUBSTITUTED_KEY,
    status: "issued",
    issuedAt: "2026-07-09T16:05:44Z",
  },
  lineage: {
    nodes: [
      { id: "n_manifest", label: "Key manifest (UNSIGNED)", kind: "manifest" },
      { id: "n_receipt", label: "Decision receipt", kind: "receipt" },
      { id: "n_checkpoint", label: "Merkle checkpoint #4183", kind: "checkpoint" },
    ],
    edges: [
      { from: "n_manifest", to: "n_receipt", eventId: "lin_ee11dd22cc33bb44" },
      { from: "n_receipt", to: "n_checkpoint", eventId: "lin_ff22ee33dd44cc55" },
    ],
  },
  governance: {
    tenantSlug: "acme-lab",
    lfTags: { classification: "synthetic", zone: "curated", trust_root: "operator-supplied" },
    rowFilter: "tenant_id_hash = current_tenant()",
    columnRestrictions: ["user_id_hash"],
  },
  claims: [
    {
      claimId: "clm_7b3e0a41",
      statement: "Signature verifies under the supplied key manifest.",
      state: "evidenced",
      receiptCount: 1,
      updatedAt: "2026-07-09T16:06:02Z",
    },
  ],
  badges: {
    digestRecomputed: true,
    signatureValid: true,
    merklePathValid: true,
    keyIdImmutable: true,
    manifestAuthenticated: false,
    epochValid: true,
    timeAnchored: true,
  },
};

// ---------------------------------------------------------------------------
// FIXTURE C — Chrono-revocation flaw.
// Key REVOKED_KEY was revoked at 15:00Z after compromise. The attacker signs a
// fresh receipt timestamped 14:00Z (one hour before revokedAt). The signature
// is valid (they hold the key) and the epoch check passes, because revocation
// is measured against the signer-asserted timestamp, not an external anchor.
// ---------------------------------------------------------------------------
const fixtureC: Scenario = {
  seam: {
    id: "C",
    label: "Chrono-revocation flaw",
    title: "Backdated one hour, past a revoked-key window",
    severity: "high",
    uiImpression: "status: issued, Issued 2026-07-09T14:00:00Z — an ordinary in-window receipt.",
    groundTruth:
      "The signing key was revoked at 15:00Z after compromise. This receipt is timestamped 14:00Z — one hour before revocation — so the epoch check accepts it and the held key produces a valid signature. Revocation is anchored to the signer's own clock, not to checkpoint inclusion order, so a compromised key can mint 'pre-revocation' receipts indefinitely. The console shows 'issued' and never reveals the key is revoked.",
    citation: "packages/enforcement-runtime/src/receipts/keyManifest.ts:113",
  },
  receipt: {
    receiptId: "rct_1234abcd5678ef90feedface00112233445566778899aabbccddeeff00112233",
    digestSha256: "sha256:0011223344556677889900aabbccddeeff00112233445566778899aabbccddee",
    keyId: REVOKED_KEY,
    status: "issued",
    issuedAt: "2026-07-09T14:00:00Z",
  },
  lineage: {
    nodes: [
      { id: "n_key", label: "Key epoch (revokedAt 15:00Z)", kind: "key" },
      { id: "n_receipt", label: "Decision receipt (ts 14:00Z)", kind: "receipt" },
    ],
    edges: [{ from: "n_key", to: "n_receipt", eventId: "lin_9988776655443322" }],
  },
  governance: {
    tenantSlug: "acme-lab",
    lfTags: { classification: "synthetic", zone: "curated", key_status: "revoked" },
    columnRestrictions: [],
  },
  claims: [
    {
      claimId: "clm_c1d2e3f4",
      statement: "Receipt falls within a valid, non-revoked key epoch.",
      state: "evidenced",
      receiptCount: 1,
      updatedAt: "2026-07-09T17:20:00Z",
    },
  ],
  badges: {
    digestRecomputed: true,
    signatureValid: true,
    merklePathValid: true,
    keyIdImmutable: true,
    manifestAuthenticated: true,
    epochValid: true,
    timeAnchored: false,
  },
};

// ---------------------------------------------------------------------------
// FIXTURE D — Empty surface.
// Two claims whose entire evidentiary basis is a zero-byte document. The
// shipped ClaimsTable and GovernanceSummary render them identically to
// evidenced claims — the UI has no affordance for empty/missing evidence.
// ---------------------------------------------------------------------------
const fixtureD: Scenario = {
  seam: {
    id: "D",
    label: "Empty surface",
    title: "Claims backed by zero-byte documents",
    severity: "institutional",
    uiImpression: "Two 'documented' claims in the table, visually identical to any evidenced claim.",
    groundTruth:
      "Illustrative: each claim cites a 0-byte stub document. The shipped ClaimsTable renders receiptCount and state with no signal that the underlying evidence file is empty — it masks a hollow claim as a normal one. There is no 'empty evidence' state anywhere in the component contract. (This pattern was real at review time for two research docs that have since been written; the fixture uses synthetic stub paths so it never asserts a false fact about the live repo.)",
    citation: "synthetic stub artifacts — see evidenceDocs below",
  },
  receipt: {
    receiptId: "rct_0000000000000000000000000000000000000000000000000000000000000000",
    digestSha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    keyId: "(no receipt — claim is documentation-only)",
    status: "disputed",
    issuedAt: "—",
  },
  lineage: { nodes: [], edges: [] },
  governance: {
    tenantSlug: "ghost-ark-repo",
    lfTags: { classification: "research-doc", zone: "docs/research" },
    columnRestrictions: [],
  },
  claims: [
    {
      claimId: "clm_stub_a",
      statement: "A doctrine claim whose only evidence is a stub document (see docs/example/STUB_DOCTRINE_A.md).",
      state: "documented",
      receiptCount: 0,
      updatedAt: "2026-07-10T01:37:50Z",
    },
    {
      claimId: "clm_stub_b",
      statement: "A second doctrine claim whose cited file is an empty placeholder (see docs/example/STUB_DOCTRINE_B.md).",
      state: "documented",
      receiptCount: 0,
      updatedAt: "2026-07-10T01:37:50Z",
    },
  ],
  badges: {
    digestRecomputed: null,
    signatureValid: null,
    merklePathValid: null,
    keyIdImmutable: null,
    manifestAuthenticated: null,
    epochValid: null,
    timeAnchored: null,
  },
  evidenceDocs: [
    { path: "docs/example/STUB_DOCTRINE_A.md", bytes: 0, referencedBy: "clm_stub_a" },
    { path: "docs/example/STUB_DOCTRINE_B.md", bytes: 0, referencedBy: "clm_stub_b" },
  ],
};

export const scenarios: Record<Scenario["seam"]["id"], Scenario> = {
  A: fixtureA,
  B: fixtureB,
  C: fixtureC,
  D: fixtureD,
};

export const scenarioOrder: Array<Scenario["seam"]["id"]> = ["A", "B", "C", "D"];
