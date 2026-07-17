import { describe, it, expect } from "vitest";
import { atom } from "../../../../packages/research-frontier/src/lobian/formula";
import { isGLFrame, refutes } from "../../../../packages/research-frontier/src/lobian/kripke";
import {
  demonstrateLobianObstacle,
  licensingObligations,
  evaluateObligation,
} from "../../../../packages/research-frontier/src/lobian/lobianObstacle";
import {
  buildReceipt,
  verifyReceipt,
  agentDigest,
} from "../../../../packages/research-frontier/src/lobian/receipt";

const invariant = atom("fail_closed"); // "every governed invoke fails closed"

describe("Löbian obstacle demonstrator", () => {
  const report = demonstrateLobianObstacle(invariant);

  it("the obstacle bites: at least one licensing obligation is refuted", () => {
    expect(report.obstacleHit).toBe(true);
  });

  it("naive soundness (□φ→φ) is REFUTED with a replaying countermodel", () => {
    const v = report.verdicts.find((x) => x.obligation.kind === "naive-soundness");
    expect(v?.status).toBe("LICENSE_REFUTED");
    if (v?.status === "LICENSE_REFUTED") {
      expect(isGLFrame(v.countermodel)).toBe(true);
      expect(refutes(v.countermodel, v.root, v.obligation.formula)).toBe(true);
    }
  });

  it("consistency (¬□⊥) is REFUTED — Gödel's second theorem for the successor", () => {
    const v = report.verdicts.find((x) => x.obligation.kind === "consistency");
    expect(v?.status).toBe("LICENSE_REFUTED");
  });

  it("Löbian self-trust (□(□φ→φ)→□φ) is CERTIFIED — but only buys provability", () => {
    const v = report.verdicts.find((x) => x.obligation.kind === "loeb-self-trust");
    expect(v?.status).toBe("LICENSE_CERTIFIED");
    if (v?.status === "LICENSE_CERTIFIED") {
      expect(v.note).toMatch(/provability, not soundness/);
    }
  });
});

describe("licensing receipts are replayable evidence", () => {
  const ts = "2026-07-17T00:00:00Z";
  const ad = agentDigest({ name: "successor-A'", strength: "same", policy: "relaxed-logging" });

  it("every verdict yields a receipt that independently verifies", () => {
    for (const o of licensingObligations(invariant)) {
      const verdict = evaluateObligation(o);
      const receipt = buildReceipt(verdict, ad, ts);
      const v = verifyReceipt(receipt);
      expect(v.valid, `${o.kind} receipt must verify`).toBe(true);
    }
  });

  it("a refutation receipt carries a countermodel, a certification carries a proof digest", () => {
    const refuted = buildReceipt(evaluateObligation(licensingObligations(invariant)[0]), ad, ts);
    expect(refuted.status).toBe("LICENSE_REFUTED");
    expect(refuted.evidence.kind).toBe("countermodel");

    const certified = buildReceipt(evaluateObligation(licensingObligations(invariant)[2]), ad, ts);
    expect(certified.status).toBe("LICENSE_CERTIFIED");
    expect(certified.evidence.kind).toBe("proof");
  });
});
