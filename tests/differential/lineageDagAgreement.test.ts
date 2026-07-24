/**
 * The lineage DAG engine, proven against REAL fixtures and GENUINELY-signed
 * extensions (not tampered stand-ins). A dev-only HMAC signer — the same
 * construction the repro harness uses, with the published dev vector — lets us
 * build honest multi-node chains, forks, and temporal anomalies whose nodes are
 * really PROVED, so an edge failure is isolated to the edge, not a broken node.
 *
 * Mirrors the spec's TC-DAG matrix: linear chains (HMAC + KMS), the BigInt
 * digest-as-mhash node, broken/temporal/fork/missing-parent edges.
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalize, sha256Hex } from "../../apps/glasshouse/lib/webReceiptVerifier";
import { verifyDecisionReceiptWeb, signedDecisionReceiptHashWeb } from "../../apps/glasshouse/lib/decisionVerifier";
import { verifyLineageGraph } from "../../apps/glasshouse/lib/lineageDagEngine";

const R = (p: string) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf-8"));
const F = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");
const HMAC_SECRET = "ghost-ark-repro-signing-dev-only-test-vector-v1";

const baseline = R("examples/reproducibility/receipts/hmac-baseline.receipt.json");
const chained = R("examples/reproducibility/receipts/hmac-chained.receipt.json");
const kmsMsg = R("examples/reproducibility/receipts/kms-style-rsa.receipt.json");
const kmsMsgKey = F("examples/reproducibility/keys/kms-style-public-key.pem");
const kmsMhash = R("examples/reproducibility/pss-digest-mode/kms-digest-mode.receipt.json");
const kmsMhashKey = F("examples/reproducibility/pss-digest-mode/public-key.pem");

/** Genuinely dev-HMAC-sign a decision receipt from its field set (no receipt_id
 *  / receipt_signature), reproducing the canonicalization + envelope exactly. */
async function devSign(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const receiptId = `grct_${await sha256Hex(canonicalize(fields))}`;
  const unsigned = { receipt_id: receiptId, ...fields };
  const canonicalPayload = canonicalize(unsigned);
  const digest = await sha256Hex(canonicalPayload);
  const mac = crypto.createHmac("sha256", HMAC_SECRET).update(canonicalPayload).digest("base64");
  const envelope = {
    algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
    digestSha256: digest,
    keyId: "local-dev-hmac",
    schemaVersion: "ghost.decision_receipt_signature.v1",
    signature: mac,
  };
  return { ...unsigned, receipt_signature: Buffer.from(JSON.stringify(envelope)).toString("base64") };
}

/** Field set for a fresh chained child, based on the real chained fixture. */
async function childOf(parent: Record<string, unknown>, over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { receipt_id: _i, receipt_signature: _s, ...fields } = chained;
  return devSign({
    ...fields,
    prev_receipt_hash: await signedDecisionReceiptHashWeb(parent),
    timestamp: "2026-07-09T00:20:00.000Z",
    request_id: "request-repro-gen",
    execution_nonce: "gen-nonce-" + Math.random().toString(36).slice(2, 8),
    ...over,
  });
}

describe("dev signer sanity", () => {
  it("a dev-signed node genuinely verifies (PROVED, not tampered)", async () => {
    const c = await childOf(chained);
    const rep = await verifyDecisionReceiptWeb(c, { hmacSecret: HMAC_SECRET });
    expect(rep.verdict, JSON.stringify(rep.checks.filter((x) => !x.passed))).toBe("PASS");
  });
});

describe("lineage DAG — valid chains", () => {
  it("TC-DAG-01: the real 2-node HMAC chain is VALID_LINEAGE", async () => {
    const g = await verifyLineageGraph([baseline, chained], { hmacSecret: HMAC_SECRET });
    expect(g.valid).toBe(true);
    expect(g.nodes.every((n) => n.verdict === "PROVED_HMAC_DEV")).toBe(true);
    expect(g.edges.map((e) => e.verdict).sort()).toEqual(["ROOT", "VERIFIED_LINK"]);
  });

  it("TC-DAG-01b: a genuine 3-node HMAC chain is VALID_LINEAGE", async () => {
    const c3 = await childOf(chained);
    const g = await verifyLineageGraph([baseline, chained, c3], { hmacSecret: HMAC_SECRET });
    expect(g.valid, JSON.stringify(g.nodes.concat(g.edges as any))).toBe(true);
    expect(g.edges.filter((e) => e.verdict === "VERIFIED_LINK")).toHaveLength(2);
  });

  it("TC-DAG-02: a KMS digest-as-message node is PROVED_KMS_MSG (root)", async () => {
    const g = await verifyLineageGraph([kmsMsg], { publicKeyPem: kmsMsgKey, pssMode: "digest-as-message" });
    expect(g.nodes[0].verdict).toBe("PROVED_KMS_MSG");
    expect(g.edges[0].verdict).toBe("ROOT");
    expect(g.valid).toBe(true);
  });

  it("TC-DAG-03: a KMS digest-as-mhash node is PROVED_KMS_MHASH via the BigInt engine", async () => {
    const g = await verifyLineageGraph([kmsMhash], { publicKeyPem: kmsMhashKey, pssMode: "digest-as-mhash" });
    expect(g.nodes[0].verdict).toBe("PROVED_KMS_MHASH");
    expect(g.valid).toBe(true);
  });

  it("TC-DAG-04: a digest-as-mhash node with NO key is UNVERIFIABLE_MODE → not valid", async () => {
    const g = await verifyLineageGraph([kmsMhash], { pssMode: "digest-as-mhash" });
    expect(g.nodes[0].verdict).toBe("UNVERIFIABLE_MODE");
    expect(g.valid).toBe(false);
  });
});

describe("lineage DAG — broken lineages (node stays PROVED, the EDGE fails)", () => {
  it("TC-DAG-05: a forged prev_receipt_hash → MISSING_PARENT", async () => {
    const orphan = await childOf(chained, { prev_receipt_hash: "sha256:" + "0".repeat(64) });
    const g = await verifyLineageGraph([baseline, chained, orphan], { hmacSecret: HMAC_SECRET });
    expect(g.nodes.every((n) => n.verdict === "PROVED_HMAC_DEV")).toBe(true); // nodes are genuine
    expect(g.edges.find((e) => e.target === orphan.receipt_id)?.verdict).toBe("MISSING_PARENT");
    expect(g.valid).toBe(false);
  });

  it("TC-DAG-06: a child timestamped before its parent → TEMPORAL_ANOMALY", async () => {
    const early = await childOf(chained, { timestamp: "2026-07-09T00:01:00.000Z" }); // before chained's 00:05
    const g = await verifyLineageGraph([baseline, chained, early], { hmacSecret: HMAC_SECRET });
    expect(g.nodes.every((n) => n.verdict === "PROVED_HMAC_DEV")).toBe(true);
    expect(g.edges.find((e) => e.target === early.receipt_id)?.verdict).toBe("TEMPORAL_ANOMALY");
    expect(g.valid).toBe(false);
  });

  it("TC-DAG-07: two genuine children of one parent → FORK_DETECTED on the second", async () => {
    const c1 = await childOf(chained, { request_id: "fork-a", execution_nonce: "fork-a-nonce" });
    const c2 = await childOf(chained, { request_id: "fork-b", execution_nonce: "fork-b-nonce", timestamp: "2026-07-09T00:25:00.000Z" });
    const g = await verifyLineageGraph([baseline, chained, c1, c2], { hmacSecret: HMAC_SECRET });
    const forkEdges = g.edges.filter((e) => e.verdict === "FORK_DETECTED");
    expect(forkEdges).toHaveLength(1);
    expect(g.valid).toBe(false);
  });

  it("a tampered node signature → INVALID_SIGNATURE (node-level, not edge)", async () => {
    const tampered = JSON.parse(JSON.stringify(chained));
    tampered.policy_hash = "cafebabe".repeat(8); // signed field → breaks digest/signature
    const g = await verifyLineageGraph([baseline, tampered], { hmacSecret: HMAC_SECRET });
    expect(g.nodes.find((n) => n.id === tampered.receipt_id)?.verdict).toBe("INVALID_SIGNATURE");
    expect(g.valid).toBe(false);
  });
});
