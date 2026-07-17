// Runnable epistemic-ceiling demonstration (Q2).
//
//   npx ts-node packages/research-frontier/src/chaitin/demo.ts
//
// Budget policy for this run: evaluator-anchored — B = U(engine sources), i.e.
// "admit nothing you cannot describe more briefly than yourself." A policy
// INSPIRED by Chaitin's theorem, not derived from it. Receipts use a fixed
// logical timestamp so digests reproduce byte-for-byte on the same toolchain.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { evaluatorAnchoredBudget, upperBound } from "./complexityBudget";
import { evaluateComprehension } from "./comprehensionGate";
import { buildChaitinReceipt, verifyChaitinReceipt } from "./receipt";

const line = "-".repeat(72);
const TS = "2026-07-17T00:00:00Z";

function xorshift32Stream(seed: number, n: number): Uint8Array {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s ^= (s << 13) >>> 0;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    s >>>= 0;
    out[i] = s & 0xff;
  }
  return out;
}

// ---- policy: evaluator-anchored budget --------------------------------------
const engineSource =
  readFileSync(join(__dirname, "complexityBudget.ts"), "utf8") +
  readFileSync(join(__dirname, "comprehensionGate.ts"), "utf8");
const B = evaluatorAnchoredBudget(engineSource);

console.log("Ghost-Ark — Epistemic Ceiling Demonstrator (GHOST-CHAITIN-V1)");
console.log(
  `policy: evaluator-anchored budget B = U(engine sources) = ${B} bytes ` +
    `(raw source ${new TextEncoder().encode(engineSource).length}B; policy, not a derived constant)`,
);

interface Case {
  name: string;
  payload: Uint8Array | string;
  gloss: string;
}
const cases: Case[] = [
  {
    name: "A: structured DANF trajectory",
    payload: JSON.stringify(
      Array.from({ length: 120 }, (_, i) => ({
        step: i,
        gate: "ledger",
        nonce: `traj-n${i}`,
        verdict: "fresh",
        policy_digest: "sha256:be27d158c3f8c0fa58ba568db4ba41ca099db9d23af503958bb0a6f0fdba2405",
      })),
    ),
    gloss: "repetitive, schema-shaped — the kind of payload a bounded assessor can actually read",
  },
  {
    name: "B: 4096 random bytes",
    payload: randomBytes(4096),
    gloss: "cryptographic noise — incompressible, refused fail-closed",
  },
  {
    name: "C (KEYSTONE): xorshift32(0xdeadbeef) stream, 4096 bytes",
    payload: xorshift32Stream(0xdeadbeef, 4096),
    gloss: "TINY true description (generator source + seed < 600B) yet opaque to compressors",
  },
];

for (const c of cases) {
  const v = evaluateComprehension(c.payload, B);
  const receipt = buildChaitinReceipt(v, c.payload, TS);
  const structural = verifyChaitinReceipt(receipt);
  const replayed = verifyChaitinReceipt(receipt, { payload: c.payload });

  console.log(line);
  console.log(`CASE ${c.name}`);
  console.log(`  ${c.gloss}`);
  console.log(
    `  raw=${v.witness.raw_bytes}B  U(x)=${v.witness.upper_bound_bytes}B  ` +
      v.witness.measurements.map((m) => `${m.algorithm}:${m.compressed_bytes}B`).join("  "),
  );
  console.log(`  VERDICT: ${v.status}`);
  console.log(`  ${v.note}`);
  console.log(`  RECEIPT ${receipt.protocol} status=${receipt.status}`);
  console.log(`    payload_digest: ${receipt.payload_digest}`);
  console.log(`    content_digest: ${receipt.content_digest}`);
  console.log(
    `    verify: structural=${structural.valid} replay=${replayed.valid} ` +
      `{digest:${replayed.checks.digest_matches}, sig:${replayed.checks.signature_matches}, ` +
      `min:${replayed.checks.min_correct}, verdict:${replayed.checks.verdict_consistent}, ` +
      `witness_replays:${replayed.checks.witness_replays}}`,
  );
}

// Case C, made quantitative: the one-sided error in one line.
const cStream = xorshift32Stream(0xdeadbeef, 4096);
const trueDesc = new TextEncoder().encode(xorshift32Stream.toString()).length + 8;
const uC = upperBound(cStream).upper_bound_bytes;
console.log(line);
console.log(
  `ONE-SIDED ERROR, MEASURED: case C admits a complete generating program of ~${trueDesc}B ` +
    `(so true K is at most that, up to O(1)), while the certified bound is ${uC}B — ` +
    `${(uC / trueDesc).toFixed(1)}x larger. The monitor certifies simplicity only; it cannot see true K.`,
);

console.log(line);
console.log(
  "CLAIM BOUNDARY: Kolmogorov complexity is uncomputable; nothing here measures\n" +
    "it or detects an 'outcomplexed' evaluator. WITHIN_BUDGET certifies a\n" +
    "toolchain-relative compression bound under an explicit policy budget.\n" +
    "EVALUATION_UNDECIDABLE records only that a payload was not certified\n" +
    "comprehensible — never that it is complex or malicious. Receipts are signed\n" +
    "with a dev-only HMAC; their assurance is the replayable compression witness.\n" +
    "This module is standalone research code; no enforcement-runtime coupling,\n" +
    "no hardware attestation, and no throughput property is claimed.",
);
