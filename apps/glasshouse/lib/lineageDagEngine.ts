/**
 * Multi-node lineage DAG verifier. Given an unordered set of decision receipts,
 * it produces a graph where every NODE carries its own cryptographic verdict
 * and every EDGE carries a causal-integrity verdict — nothing is drawn on trust.
 *
 * Grounding (not the idealized spec): edges use the runtime's ACTUAL chain rule,
 * `prev_receipt_hash === sha256(canonical(FULL signed parent))`
 * (`signedDecisionReceiptHashWeb`), empirically confirmed against the
 * hmac-baseline→hmac-chained fixtures — NOT `SHA256(Canonical(payload))`. Node
 * verdicts come from the single-sourced `verifyDecisionReceiptWeb` (HMAC dev,
 * KMS digest-as-message via subtle, KMS digest-as-mhash via the BigInt engine),
 * so there is no second crypto path to drift.
 *
 * "Valid graph" is deliberately strict: every node PROVED and every edge
 * VERIFIED_LINK or ROOT. A single INVALID/UNVERIFIABLE node or a broken/forked/
 * out-of-order edge makes the whole lineage invalid.
 */

import { verifyDecisionReceiptWeb, signedDecisionReceiptHashWeb, type DecisionVerifyOptions } from "./decisionVerifier";

export type NodeVerdict =
  | "PROVED_KMS_MSG"
  | "PROVED_KMS_MHASH"
  | "PROVED_HMAC_DEV"
  | "INVALID_SIGNATURE"
  /** Structurally malformed / not a decision receipt at all. Distinct from a
   *  signature that was checked and failed — conflating them tells the auditor
   *  a forgery was detected when the truth is the input was never a receipt. */
  | "MALFORMED"
  /** Could not be evaluated (no key/secret supplied, unsupported mode). NOT a
   *  detected tamper — a missing input is not evidence of an attack. */
  | "UNVERIFIABLE_MODE";

export type EdgeVerdict = "VERIFIED_LINK" | "BROKEN_LINK" | "TEMPORAL_ANOMALY" | "FORK_DETECTED" | "MISSING_PARENT" | "ROOT";

export interface DagNode {
  id: string;
  verdict: NodeVerdict;
  detail: string;
  signedHash: string;
  tenantIdHash: string;
  timestamp: string;
  signatureAlg: string;
}

export interface DagEdge {
  source: string; // parent receipt_id, or "∅" for a root
  target: string; // child receipt_id
  verdict: EdgeVerdict;
  detail: string;
}

export interface LineageGraph {
  nodes: DagNode[];
  edges: DagEdge[];
  /** Every node PROVED and every edge VERIFIED_LINK or ROOT. */
  valid: boolean;
  /**
   * The WEAKEST proof tier in the graph — the Honest Design Rule at the
   * aggregate level. `valid` alone is a boolean, and a renderer keying off it
   * painted a chain of dev-HMAC receipts emerald "LINEAGE VERIFIED" while the
   * very same receipts rendered amber on the single-receipt view. A chain is
   * never stronger than its weakest node, so the tier travels with the verdict.
   */
  weakestNodeTier: "ASYMMETRIC" | "DEV_SYMMETRIC" | "NONE";
  /** Inputs that were not decision receipts at all, reported rather than
   *  silently dropped — a graph that "verified" after entries vanished would
   *  be a lie of omission. */
  rejectedInputs: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HMAC_ALG = "LOCAL_HMAC_SHA256_DEV_ONLY";
const KMS_ALG = "KMS_SIGN_RSASSA_PSS_SHA_256";

async function nodeVerdict(receipt: Record<string, unknown>, opts: DecisionVerifyOptions): Promise<{ verdict: NodeVerdict; detail: string }> {
  const alg = receipt.signature_alg;
  // mhash without a key cannot be checked at all → honest UNVERIFIABLE_MODE.
  if (alg === KMS_ALG && (opts.pssMode ?? "digest-as-message") === "digest-as-mhash" && !opts.publicKeyPem) {
    return { verdict: "UNVERIFIABLE_MODE", detail: "digest-as-mhash requires a public key to verify." };
  }
  const rep = await verifyDecisionReceiptWeb(receipt, opts);
  const sig = rep.checks.find((c) => c.name === "signature");
  // "No key supplied" is not a detected forgery. Reporting it as
  // INVALID_SIGNATURE tells the auditor an attack was found when the truth is
  // the verifier was handed nothing to check with.
  if (sig && !sig.passed && /requires|no public key|Failing closed/i.test(sig.detail) && !sig.unverifiable) {
    return { verdict: "UNVERIFIABLE_MODE", detail: sig.detail };
  }
  // PASS_DEV_SYMMETRIC is a genuine verification, but a symmetric one — it maps
  // to its own node tier so a renderer cannot treat it as asymmetric proof.
  if (rep.verdict === "PASS_DEV_SYMMETRIC" || (rep.verdict === "PASS" && alg === HMAC_ALG)) {
    return { verdict: "PROVED_HMAC_DEV", detail: sig?.detail ?? "HMAC verified (dev-only, symmetric)." };
  }
  if (rep.verdict === "PASS") {
    return {
      verdict: (opts.pssMode ?? "digest-as-message") === "digest-as-mhash" ? "PROVED_KMS_MHASH" : "PROVED_KMS_MSG",
      detail: sig?.detail ?? "KMS RSA-PSS verified.",
    };
  }
  if (rep.verdict === "UNVERIFIABLE") return { verdict: "UNVERIFIABLE_MODE", detail: sig?.detail ?? "unverifiable in this build." };
  const firstFail = rep.checks.find((c) => !c.passed && !c.unverifiable);
  // A structural rejection is not a detected forgery.
  if (firstFail && firstFail.name === "schema") return { verdict: "MALFORMED", detail: firstFail.detail };
  return { verdict: "INVALID_SIGNATURE", detail: firstFail ? `${firstFail.name}: ${firstFail.detail}` : "verification failed." };
}

/**
 * Builds and verifies the lineage graph. `options` are per-graph verification
 * options threaded to every node (a heterogeneous graph mixing KMS PSS modes
 * would need per-node options; the fixtures use one mode per graph).
 */
export async function verifyLineageGraph(receipts: unknown[], options: DecisionVerifyOptions = {}): Promise<LineageGraph> {
  const clean = receipts.filter(isRecord) as Record<string, unknown>[];
  const rejectedInputs = receipts.length - clean.length;

  // Pass 1+2: per-node crypto + index by the real signed hash.
  const nodes: DagNode[] = [];
  const byHash = new Map<string, DagNode>();
  const receiptById = new Map<string, Record<string, unknown>>();
  for (const r of clean) {
    const signedHash = await signedDecisionReceiptHashWeb(r);
    const nv = await nodeVerdict(r, options);
    const node: DagNode = {
      id: String(r.receipt_id),
      verdict: nv.verdict,
      detail: nv.detail,
      signedHash,
      tenantIdHash: String(r.tenant_id_hash),
      timestamp: String(r.timestamp),
      signatureAlg: String(r.signature_alg),
    };
    nodes.push(node);
    byHash.set(signedHash, node);
    receiptById.set(node.id, r);
  }

  // Pass 3+4: adjacency + causal/temporal/tenant/fork validation.
  const edges: DagEdge[] = [];
  const parentSeen = new Set<string>();
  for (const node of nodes) {
    const r = receiptById.get(node.id)!;
    const prev = r.prev_receipt_hash;
    if (prev === null || prev === undefined) {
      edges.push({ source: "∅", target: node.id, verdict: "ROOT", detail: "no previous receipt hash (chain head)." });
      continue;
    }
    const parent = byHash.get(String(prev));
    if (!parent) {
      edges.push({ source: `missing:${String(prev).slice(0, 20)}…`, target: node.id, verdict: "MISSING_PARENT", detail: "prev_receipt_hash matches no receipt in this set (orphan or forged link)." });
      continue;
    }
    let verdict: EdgeVerdict = "VERIFIED_LINK";
    let detail = "prev_receipt_hash equals sha256(canonical(signed parent)).";
    const childTime = Date.parse(node.timestamp);
    const parentTime = Date.parse(parent.timestamp);
    if (parent.tenantIdHash !== node.tenantIdHash) {
      verdict = "BROKEN_LINK"; detail = "tenant-chain break — child and parent differ in tenant_id_hash.";
    } else if (!Number.isFinite(childTime) || !Number.isFinite(parentTime)) {
      // NaN comparisons are ALWAYS false, so an unparseable timestamp made the
      // monotonicity test pass vacuously and the edge still claimed
      // VERIFIED_LINK. An unreadable clock is an unchecked ordering, never a
      // verified one.
      verdict = "TEMPORAL_ANOMALY";
      detail = `timestamp not parseable (child ${JSON.stringify(node.timestamp)}, parent ${JSON.stringify(parent.timestamp)}) — ordering could not be checked.`;
    } else if (childTime <= parentTime) {
      verdict = "TEMPORAL_ANOMALY"; detail = `child timestamp ${node.timestamp} is not after parent ${parent.timestamp}.`;
    } else if (parentSeen.has(parent.signedHash)) {
      verdict = "FORK_DETECTED"; detail = "another receipt already links to this parent (unpermitted branch).";
    }
    parentSeen.add(parent.signedHash);
    edges.push({ source: parent.id, target: node.id, verdict, detail });
  }

  const allNodesProved = nodes.every((n) => n.verdict === "PROVED_HMAC_DEV" || n.verdict === "PROVED_KMS_MSG" || n.verdict === "PROVED_KMS_MHASH");
  const allEdgesSound = edges.every((e) => e.verdict === "VERIFIED_LINK" || e.verdict === "ROOT");
  // Weakest link, explicitly: one dev-symmetric node makes the WHOLE lineage
  // dev-symmetric, however many asymmetric nodes surround it.
  const weakestNodeTier: LineageGraph["weakestNodeTier"] =
    nodes.length === 0 ? "NONE" : nodes.some((n) => n.verdict === "PROVED_HMAC_DEV") ? "DEV_SYMMETRIC" : allNodesProved ? "ASYMMETRIC" : "NONE";
  return { nodes, edges, valid: allNodesProved && allEdgesSound && rejectedInputs === 0, weakestNodeTier, rejectedInputs };
}
