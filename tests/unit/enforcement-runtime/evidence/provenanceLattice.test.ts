import { describe, expect, it } from "vitest";
import {
  admitDelegatedEvidence,
  assertAssignableProvenanceClass,
  assertProvenanceClass,
  compareProvenance,
  deriveAggregateClass,
  detectVacuousRequirement,
  evaluateEvidenceFloor,
  joinProvenance,
  meetProvenance,
  meetsProvenanceFloor,
  provenanceClasses,
  provenanceRank,
  ProvenanceClass,
  ProvenanceLabeledEvidence
} from "../../../../packages/enforcement-runtime/src/evidence/provenanceLattice";

function digestOf(seed: string): string {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

function element(overrides: Partial<ProvenanceLabeledEvidence> = {}): ProvenanceLabeledEvidence {
  return {
    evidenceId: "evd-1",
    contentDigest: digestOf("a"),
    sourceId: "source-1",
    provenanceClass: "SOURCE_SIGNED",
    ...overrides
  };
}

describe("provenance class order", () => {
  it("ranks the chain strictly", () => {
    const ranks = provenanceClasses.map((cls) => provenanceRank(cls));
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });

  it("compare is antisymmetric and total over all pairs", () => {
    for (const a of provenanceClasses) {
      for (const b of provenanceClasses) {
        expect(compareProvenance(a, b) + compareProvenance(b, a)).toBe(0);
        if (compareProvenance(a, b) === 0) {
          expect(a).toBe(b);
        }
      }
    }
  });

  it("join and meet satisfy lattice laws over all pairs", () => {
    for (const a of provenanceClasses) {
      for (const b of provenanceClasses) {
        expect(joinProvenance(a, b)).toBe(joinProvenance(b, a));
        expect(meetProvenance(a, b)).toBe(meetProvenance(b, a));
        expect(joinProvenance(a, meetProvenance(a, b))).toBe(a);
        expect(meetProvenance(a, joinProvenance(a, b))).toBe(a);
      }
    }
  });

  it("fails closed on unknown class labels", () => {
    expect(() => assertProvenanceClass("TOTALLY_TRUSTED")).toThrow(/Unknown evidence provenance class/u);
    expect(() => provenanceRank("nonsense" as ProvenanceClass)).toThrow(/Unknown evidence provenance class/u);
  });

  it("rejects direct assignment of derive-only classes", () => {
    expect(() => assertAssignableProvenanceClass("CROSS_WITNESSED")).toThrow(/derive-only/u);
    expect(() => assertAssignableProvenanceClass("SOURCE_SIGNED")).not.toThrow();
  });
});

describe("delegation admission (no laundering)", () => {
  it("admits at the meet of claimed and re-verified classes", () => {
    expect(
      admitDelegatedEvidence({ claimedClass: "CROSS_WITNESSED", reverifiedClass: "AGENT_ASSERTED" })
    ).toBe("AGENT_ASSERTED");
    expect(
      admitDelegatedEvidence({ claimedClass: "GATEWAY_RECORDED", reverifiedClass: "SOURCE_SIGNED" })
    ).toBe("GATEWAY_RECORDED");
  });

  it("never admits above the claimed class for any pair", () => {
    for (const claimed of provenanceClasses) {
      for (const reverified of provenanceClasses.filter((cls) => cls !== "CROSS_WITNESSED")) {
        const admitted = admitDelegatedEvidence({ claimedClass: claimed, reverifiedClass: reverified });
        expect(provenanceRank(admitted)).toBeLessThanOrEqual(provenanceRank(claimed));
        expect(provenanceRank(admitted)).toBeLessThanOrEqual(provenanceRank(reverified));
      }
    }
  });

  it("rejects a re-verified class the boundary could not have computed", () => {
    expect(() =>
      admitDelegatedEvidence({ claimedClass: "SOURCE_SIGNED", reverifiedClass: "CROSS_WITNESSED" })
    ).toThrow(/derive-only/u);
  });
});

describe("aggregate derivation", () => {
  it("upgrades to CROSS_WITNESSED when two distinct signed sources agree on one digest", () => {
    const aggregate = deriveAggregateClass([
      element({ evidenceId: "evd-1", sourceId: "source-1" }),
      element({ evidenceId: "evd-2", sourceId: "source-2" })
    ]);
    expect(aggregate).toBe("CROSS_WITNESSED");
  });

  it("does not upgrade for a single source repeated", () => {
    const aggregate = deriveAggregateClass([
      element({ evidenceId: "evd-1", sourceId: "source-1" }),
      element({ evidenceId: "evd-2", sourceId: "source-1" })
    ]);
    expect(aggregate).toBe("SOURCE_SIGNED");
  });

  it("does not upgrade for agreeing agent assertions", () => {
    const aggregate = deriveAggregateClass([
      element({ evidenceId: "evd-1", sourceId: "source-1", provenanceClass: "AGENT_ASSERTED" }),
      element({ evidenceId: "evd-2", sourceId: "source-2", provenanceClass: "AGENT_ASSERTED" })
    ]);
    expect(aggregate).toBe("AGENT_ASSERTED");
  });

  it("rejects aggregation across differing digests", () => {
    expect(() =>
      deriveAggregateClass([
        element({ evidenceId: "evd-1", sourceId: "source-1", contentDigest: digestOf("a") }),
        element({ evidenceId: "evd-2", sourceId: "source-2", contentDigest: digestOf("b") })
      ])
    ).toThrow(/same content digest/u);
  });

  it("rejects elements that carry a derive-only class directly", () => {
    expect(() =>
      deriveAggregateClass([element({ provenanceClass: "CROSS_WITNESSED" })])
    ).toThrow(/derive-only/u);
  });
});

describe("evidence floor evaluation", () => {
  const requirement = {
    effectClass: "external_communication",
    floor: "SOURCE_SIGNED" as ProvenanceClass,
    minimumDistinctSources: 2
  };

  it("satisfies the floor with distinct qualifying sources", () => {
    const evaluation = evaluateEvidenceFloor(
      [element({ sourceId: "source-1" }), element({ evidenceId: "evd-2", sourceId: "source-2" })],
      requirement
    );
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.qualifyingSourceIds).toEqual(["source-1", "source-2"]);
  });

  it("does not satisfy the floor with one source repeated", () => {
    const evaluation = evaluateEvidenceFloor(
      [element({ sourceId: "source-1" }), element({ evidenceId: "evd-2", sourceId: "source-1" })],
      requirement
    );
    expect(evaluation.satisfied).toBe(false);
  });

  it("is monotone: below-floor elements never flip an unsatisfied verdict", () => {
    const base = [element({ sourceId: "source-1" })];
    const flood: ProvenanceLabeledEvidence[] = Array.from({ length: 50 }, (_, index) =>
      element({
        evidenceId: `agent-${index}`,
        sourceId: `agent-source-${index}`,
        provenanceClass: "AGENT_ASSERTED"
      })
    );
    const before = evaluateEvidenceFloor(base, requirement);
    const after = evaluateEvidenceFloor([...base, ...flood], requirement);
    expect(before.satisfied).toBe(false);
    expect(after.satisfied).toBe(false);
    expect(after.qualifyingSourceIds).toEqual(before.qualifyingSourceIds);
  });

  it("rejects malformed content digests", () => {
    expect(() =>
      evaluateEvidenceFloor([element({ contentDigest: "sha256:not-hex" })], requirement)
    ).toThrow(/contentDigest/u);
  });

  it("rejects a non-positive distinct source count", () => {
    expect(() =>
      evaluateEvidenceFloor([element()], { ...requirement, minimumDistinctSources: 0 })
    ).toThrow(/positive safe integer/u);
  });
});

describe("vacuity detection", () => {
  it("flags an AGENT_ASSERTED floor as vacuous", () => {
    const finding = detectVacuousRequirement({
      effectClass: "external_communication",
      floor: "AGENT_ASSERTED",
      minimumDistinctSources: 1
    });
    expect(finding.vacuous).toBe(true);
  });

  it("accepts floors above agent control", () => {
    const finding = detectVacuousRequirement({
      effectClass: "external_communication",
      floor: "GATEWAY_RECORDED",
      minimumDistinctSources: 1
    });
    expect(finding.vacuous).toBe(false);
  });
});

describe("floor comparison", () => {
  it("meetsProvenanceFloor agrees with rank order for all pairs", () => {
    for (const observed of provenanceClasses) {
      for (const floor of provenanceClasses) {
        expect(meetsProvenanceFloor(observed, floor)).toBe(provenanceRank(observed) >= provenanceRank(floor));
      }
    }
  });
});
