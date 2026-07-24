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
  if (rep.verdict === "PASS") {
    if (alg === HMAC_ALG) return { verdict: "PROVED_HMAC_DEV", detail: sig?.detail ?? "HMAC verified (dev-only)." };
    return {
      verdict: (opts.pssMode ?? "digest-as-message") === "digest-as-mhash" ? "PROVED_KMS_MHASH" : "PROVED_KMS_MSG",
      detail: sig?.detail ?? "KMS RSA-PSS verified.",
    };
  }
  if (rep.verdict === "UNVERIFIABLE") return { verdict: "UNVERIFIABLE_MODE", detail: sig?.detail ?? "unverifiable in this build." };
  const firstFail = rep.checks.find((c) => !c.passed && !c.unverifiable);
  return { verdict: "INVALID_SIGNATURE", detail: firstFail ? `${firstFail.name}: ${firstFail.detail}` : "verification failed." };
}

/**
 * Builds and verifies the lineage graph. `options` are per-graph verification
 * options threaded to every node (a heterogeneous graph mixing KMS PSS modes
 * would need per-node options; the fixtures use one mode per graph).
 */
export async function verifyLineageGraph(receipts: unknown[], options: DecisionVerifyOptions = {}): Promise<LineageGraph> {
  const clean = receipts.filter(isRecord) as Record<string, unknown>[];

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
    if (parent.tenantIdHash !== node.tenantIdHash) {
      verdict = "BROKEN_LINK"; detail = "tenant-chain break — child and parent differ in tenant_id_hash.";
    } else if (Date.parse(node.timestamp) <= Date.parse(parent.timestamp)) {
      verdict = "TEMPORAL_ANOMALY"; detail = `child timestamp ${node.timestamp} is not after parent ${parent.timestamp}.`;
    } else if (parentSeen.has(parent.signedHash)) {
      verdict = "FORK_DETECTED"; detail = "another receipt already links to this parent (unpermitted branch).";
    }
    parentSeen.add(parent.signedHash);
    edges.push({ source: parent.id, target: node.id, verdict, detail });
  }

  const allNodesProved = nodes.every((n) => n.verdict === "PROVED_HMAC_DEV" || n.verdict === "PROVED_KMS_MSG" || n.verdict === "PROVED_KMS_MHASH");
  const allEdgesSound = edges.every((e) => e.verdict === "VERIFIED_LINK" || e.verdict === "ROOT");
  return { nodes, edges, valid: allNodesProved && allEdgesSound };
}
