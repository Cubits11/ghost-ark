import { describe, expect, it } from "vitest";
import {
  evaluateEvidenceStanding,
  type DowngradeEvent,
} from "../../../packages/research-frontier/src/evidenceStaleness";

describe("evidence staleness lattice", () => {
  it("reports current standing with no events", () => {
    const report = evaluateEvidenceStanding({ receiptId: "rct_1" });
    expect(report.standing).toBe("current");
    expect(report.applied_downgrades).toHaveLength(0);
  });

  it("descends to the worst applicable standing", () => {
    const events: DowngradeEvent[] = [
      { kind: "policy_superseded", reason: "policy v7 -> v8", source: "policy:v8" },
      { kind: "key_revoked", reason: "key leaked", source: "ledger:42" },
    ];
    const report = evaluateEvidenceStanding({ receiptId: "rct_1", events });
    expect(report.standing).toBe("key_revoked");
  });

  it("is order-independent (deterministic) regardless of input event order", () => {
    const events: DowngradeEvent[] = [
      { kind: "drift_observed", reason: "iam broadened", source: "cloudtrail:abc" },
      { kind: "policy_superseded", reason: "policy v7 -> v8", source: "policy:v8" },
    ];
    const a = evaluateEvidenceStanding({ receiptId: "rct_1", events });
    const b = evaluateEvidenceStanding({ receiptId: "rct_1", events: [...events].reverse() });
    expect(a).toStrictEqual(b);
  });

  it("records only strict downgrades in the trail", () => {
    const events: DowngradeEvent[] = [
      { kind: "key_revoked", reason: "leaked", source: "ledger:42" },
      { kind: "policy_superseded", reason: "v8", source: "policy:v8" }, // does not improve, ignored
    ];
    const report = evaluateEvidenceStanding({ receiptId: "rct_1", events });
    expect(report.standing).toBe("key_revoked");
    // policy_superseded (rank 2) cannot appear after key_revoked (rank 4) is reached
    expect(report.applied_downgrades.map((d) => d.kind)).toEqual(["policy_superseded", "key_revoked"]);
  });

  it("derives freshness from ledger-epoch lag, not wall clock", () => {
    const report = evaluateEvidenceStanding({
      receiptId: "rct_1",
      freshness: { maxEpochLag: 3, inclusionEpochIndex: 40, evaluationEpochIndex: 46 },
    });
    expect(report.standing).toBe("stale");
    expect(report.applied_downgrades[0].kind).toBe("freshness_exceeded");
    expect(report.applied_downgrades[0].source).toBe("ledger:40->46");
  });

  it("stays current when within the freshness window", () => {
    const report = evaluateEvidenceStanding({
      receiptId: "rct_1",
      freshness: { maxEpochLag: 10, inclusionEpochIndex: 40, evaluationEpochIndex: 46 },
    });
    expect(report.standing).toBe("current");
  });

  it("rejects downgrade events missing provenance", () => {
    expect(() =>
      evaluateEvidenceStanding({
        receiptId: "rct_1",
        events: [{ kind: "key_revoked", reason: "leaked", source: "" }],
      }),
    ).toThrow();
  });

  it("carries the non-claim that standing is not a probability", () => {
    const report = evaluateEvidenceStanding({ receiptId: "rct_1" });
    expect(report.non_claims.some((n) => n.toLowerCase().includes("not a probability"))).toBe(true);
  });

  it("fails closed on a prototype-name kind (no `in`-operator fail-open)", () => {
    for (const bogus of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(() =>
        evaluateEvidenceStanding({
          receiptId: "rct_1",
          events: [{ kind: bogus as unknown as DowngradeEvent["kind"], reason: "x", source: "s" }],
        }),
      ).toThrow();
    }
  });

  it("emits an order-independent trail for same-kind/same-source ties", () => {
    const events: DowngradeEvent[] = [
      { kind: "drift_observed", reason: "reasonA", source: "cloudtrail:abc", ledgerIndex: 1 },
      { kind: "drift_observed", reason: "reasonB", source: "cloudtrail:abc", ledgerIndex: 2 },
    ];
    const a = evaluateEvidenceStanding({ receiptId: "rct_1", events });
    const b = evaluateEvidenceStanding({ receiptId: "rct_1", events: [...events].reverse() });
    expect(a).toStrictEqual(b);
  });

  it("rejects a malformed ledgerIndex", () => {
    expect(() =>
      evaluateEvidenceStanding({
        receiptId: "rct_1",
        events: [{ kind: "key_revoked", reason: "x", source: "s", ledgerIndex: Number.NaN }],
      }),
    ).toThrow();
  });
});
