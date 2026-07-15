import { describe, expect, it } from "vitest";
import { canonicalize } from "../../../packages/receipt-schema/src/hashCanonicalization";
import { SpeculativeContextManager } from "../../../packages/research-frontier/src/speculativeExecution/stateForker";
import {
  EvidenceFloorRequirement,
  ProvenanceLabeledEvidence
} from "../../../packages/enforcement-runtime/src/evidence/provenanceLattice";

const requirement: EvidenceFloorRequirement = {
  effectClass: "external_communication",
  floor: "GATEWAY_RECORDED",
  minimumDistinctSources: 1
};

function gatewayEvidence(): ProvenanceLabeledEvidence {
  return {
    evidenceId: "evd-transit-1",
    contentDigest: `sha256:${"a".repeat(64)}`,
    sourceId: "PostgresTool",
    provenanceClass: "GATEWAY_RECORDED"
  };
}

function agentAssertedEvidence(): ProvenanceLabeledEvidence {
  return {
    evidenceId: "evd-claim-1",
    contentDigest: `sha256:${"b".repeat(64)}`,
    sourceId: "the-agent-itself",
    provenanceClass: "AGENT_ASSERTED"
  };
}

describe("speculative collapse semantics", () => {
  it("commits a speculation when boundary-labeled evidence meets the floor", () => {
    const manager = new SpeculativeContextManager({ balance: 100, log: ["init"] });
    const draft = manager.fork();
    draft.balance = 42;
    (draft.log as string[]).push("transfer");

    const result = manager.commitSpeculation([gatewayEvidence()], requirement);

    expect(result.dirtyKeys).toEqual(["balance", "log"]);
    expect(manager.snapshot().balance).toBe(42);
  });

  it("refuses collapse on agent-asserted evidence and leaves canonical state untouched", () => {
    const manager = new SpeculativeContextManager({ balance: 100 });
    const before = canonicalize(manager.snapshot());

    const draft = manager.fork();
    draft.balance = 0;
    draft.poisoned = "the dream thread believed the FSA";

    expect(() => manager.commitSpeculation([agentAssertedEvidence()], requirement)).toThrowError(
      /Collapse refused/u
    );
    expect(canonicalize(manager.snapshot())).toBe(before);
  });

  it("records abort markers as digests that carry no draft content", () => {
    const manager = new SpeculativeContextManager({ balance: 100 });
    const draft = manager.fork();
    draft.secretPlan = "exfiltrate-everything";

    const marker = manager.abortSpeculation("external_communication");

    expect(marker.draftDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(manager.abortMarkers())).not.toContain("exfiltrate-everything");
    expect(manager.snapshot()).not.toHaveProperty("secretPlan");
  });

  it("a refused collapse also aborts: the poisoned draft is discarded, not retryable", () => {
    const manager = new SpeculativeContextManager({ balance: 100 });
    const draft = manager.fork();
    draft.balance = 0;

    expect(() => manager.commitSpeculation([agentAssertedEvidence()], requirement)).toThrowError();
    expect(manager.abortMarkers()).toHaveLength(1);
    expect(() => manager.commitSpeculation([gatewayEvidence()], requirement)).toThrowError(
      /No active speculation/u
    );
  });

  it("refuses nested forks", () => {
    const manager = new SpeculativeContextManager({ a: 1 });
    manager.fork();
    expect(() => manager.fork()).toThrowError(/nested forks are refused/u);
  });

  it("rejects non-JSON execution contexts outright", () => {
    expect(
      () => new SpeculativeContextManager({ handler: (() => undefined) as unknown as string })
    ).toThrowError(/JSON-serializable/u);
  });
});
