import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { atom, box, imp, and, not } from "../../../../packages/research-frontier/src/lobian/formula";
import {
  type KripkeModel,
  isGLFrame,
  isIrreflexive,
  isTransitive,
  refutes,
  satisfies,
} from "../../../../packages/research-frontier/src/lobian/kripke";
import { decide, isTheorem } from "../../../../packages/research-frontier/src/lobian/glTableau";
import {
  licensingObligations,
  evaluateObligation,
} from "../../../../packages/research-frontier/src/lobian/lobianObstacle";
import {
  buildReceipt,
  verifyReceipt,
  danf,
} from "../../../../packages/research-frontier/src/lobian/receipt";

const p = atom("p");
const TKEY = "test-hmac-key";

describe("frame mutation oracle — doctoring a countermodel breaks it", () => {
  it("adding a reflexive edge to a □p→p countermodel destroys BOTH the frame and the refutation", () => {
    const r = decide(imp(box(p), p)); // □p→p — refutable
    expect(r.theorem).toBe(false);
    if (r.theorem) return;
    const good = r.countermodel;
    expect(isGLFrame(good)).toBe(true);
    expect(refutes(good, r.root, imp(box(p), p))).toBe(true);

    // Doctor: add a reflexive edge at the root.
    const doctored: KripkeModel = { ...good, edges: [...good.edges, [r.root, r.root]] };
    expect(isIrreflexive(doctored)).toBe(false);
    expect(isGLFrame(doctored)).toBe(false); // violently rejected as a GL frame
    // And the semantics flip: with a reflexive edge, □p→p is no longer false.
    expect(satisfies(doctored, r.root, imp(box(p), p))).toBe(true);
    expect(refutes(doctored, r.root, imp(box(p), p))).toBe(false);
  });

  it("breaking transitivity is caught", () => {
    const nonTrans: KripkeModel = {
      worlds: ["a", "b", "c"],
      edges: [
        ["a", "b"],
        ["b", "c"],
      ],
      valuation: { a: [], b: [], c: [] },
    };
    expect(isTransitive(nonTrans)).toBe(false);
    expect(isGLFrame(nonTrans)).toBe(false);
  });
});

describe("prover soundness — the engine is not over-eager", () => {
  it("refuses to prove textbook non-theorems (an unsound prover would accept these)", () => {
    for (const nonThm of [imp(box(p), p), not(box(atom("q"))), imp(box(box(p)), box(p))]) {
      expect(isTheorem(nonThm)).toBe(false);
    }
  });

  it("every proof-tree theorem is genuinely valid on a suite of GL frames (soundness spot-check)", () => {
    const q = atom("q");
    const frames: KripkeModel[] = [
      { worlds: ["w0"], edges: [], valuation: { w0: [] } },
      { worlds: ["w0"], edges: [], valuation: { w0: ["p", "q"] } },
      {
        worlds: ["w0", "w1"],
        edges: [["w0", "w1"]],
        valuation: { w0: ["p"], w1: ["q"] },
      },
      {
        worlds: ["w0", "w1", "w2"],
        edges: [
          ["w0", "w1"],
          ["w0", "w2"],
          ["w1", "w2"],
        ],
        valuation: { w0: [], w1: ["p"], w2: ["q"] },
      },
    ];
    const theorems = [
      imp(box(imp(box(p), p)), box(p)), // Löb
      imp(box(imp(p, q)), imp(box(p), box(q))), // K
      imp(box(p), box(box(p))), // 4
    ];
    for (const thm of theorems) {
      expect(isTheorem(thm)).toBe(true);
      for (const m of frames) {
        for (const w of m.worlds) {
          expect(satisfies(m, w, thm), `theorem must hold at every world`).toBe(true);
        }
      }
    }
  });
});

describe("receipt tamper oracle — evidence, not just signature", () => {
  const obligation = licensingObligations(p)[0]; // naive soundness □p→p (refuted)
  const verdict = evaluateObligation(obligation);
  const receipt = buildReceipt(verdict, "sha256:agent", "2026-07-17T00:00:00Z", TKEY);

  it("a clean receipt verifies", () => {
    const v = verifyReceipt(receipt, TKEY);
    expect(v.valid).toBe(true);
    expect(v.checks).toEqual({ digest_matches: true, signature_matches: true, evidence_replays: true });
  });

  it("tampering the countermodel without re-signing fails the digest", () => {
    const tampered = structuredClone(receipt);
    if (tampered.evidence.kind === "countermodel") {
      tampered.evidence.model.valuation[tampered.evidence.root] = ["p"]; // make p true at root
    }
    const v = verifyReceipt(tampered, TKEY);
    expect(v.checks.digest_matches).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("tampering the signature fails signature check", () => {
    const v = verifyReceipt({ ...receipt, signature: "deadbeef" }, TKEY);
    expect(v.checks.signature_matches).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("a FORGED receipt — attacker re-signs a doctored non-GL countermodel — still fails because evidence does not replay", () => {
    // Attacker swaps in a reflexive (non-GL) frame and honestly recomputes digest+signature.
    const forged = structuredClone(receipt);
    if (forged.evidence.kind === "countermodel") {
      forged.evidence.model.edges = [[forged.evidence.root, forged.evidence.root]]; // reflexive
    }
    const unsigned = {
      protocol: forged.protocol,
      status: forged.status,
      obligation_kind: forged.obligation_kind,
      invariant: forged.invariant,
      obligation: forged.obligation,
      agent_digest: forged.agent_digest,
      evidence: forged.evidence,
      timestamp: forged.timestamp,
    };
    forged.content_digest = `sha256:${createHash("sha256").update(danf(unsigned)).digest("hex")}`;
    forged.signature = createHmac("sha256", TKEY).update(forged.content_digest).digest("hex");

    const v = verifyReceipt(forged, TKEY);
    expect(v.checks.digest_matches).toBe(true); // attacker recomputed honestly
    expect(v.checks.signature_matches).toBe(true); // and re-signed
    expect(v.checks.evidence_replays).toBe(false); // BUT the countermodel is not a GL frame
    expect(v.valid).toBe(false); // so the receipt is rejected on evidence, not signature
  });
});

describe("receipt determinism", () => {
  it("same verdict + timestamp ⇒ identical content digest", () => {
    const o = licensingObligations(and(p, atom("q")))[1]; // consistency
    const a = buildReceipt(evaluateObligation(o), "sha256:x", "2026-07-17T00:00:00Z", TKEY);
    const b = buildReceipt(evaluateObligation(o), "sha256:x", "2026-07-17T00:00:00Z", TKEY);
    expect(a.content_digest).toBe(b.content_digest);
    expect(a.signature).toBe(b.signature);
  });
});
