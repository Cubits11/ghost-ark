import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateHumanReviewDecision,
  validateHumanReviewQueueItem,
  validateHumanReviewWorkflowLinkage,
  validateIncidentReport,
} from "../../../packages/research-frontier/src/humanReview";

const fixtureRoot = "examples/research/human-review";

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${fixtureRoot}/${name}`, "utf8")) as Record<
    string,
    unknown
  >;
}

describe("human review and incident research contracts", () => {
  it("validates the false-positive queue and decision fixtures", () => {
    const queueItem = readFixture("false-positive-queue-item.json");
    const decision = readFixture("false-positive-decision.json");

    expect(() => validateHumanReviewQueueItem(queueItem)).not.toThrow();
    expect(() => validateHumanReviewDecision(decision)).not.toThrow();
    expect(() =>
      validateHumanReviewWorkflowLinkage({ queueItem, decision }),
    ).not.toThrow();
    expect(decision.disposition).toBe("false_positive");
    expect(JSON.stringify(decision.non_claims)).toContain(
      "not independently established ground truth",
    );
  });

  it("validates the escalated queue, decision, and incident chain", () => {
    const queueItem = readFixture("escalated-queue-item.json");
    const decision = readFixture("escalated-decision.json");
    const incident = readFixture("example-incident.json");

    expect(() => validateIncidentReport(incident)).not.toThrow();
    expect(() =>
      validateHumanReviewWorkflowLinkage({ queueItem, decision, incident }),
    ).not.toThrow();
  });

  it("rejects a decision that changes the linked receipt digest", () => {
    const queueItem = readFixture("false-positive-queue-item.json");
    const decision = readFixture("false-positive-decision.json");
    const references = decision.receipt_references as Array<
      Record<string, unknown>
    >;
    references[0].receipt_digest = `sha256:${"0".repeat(64)}`;

    expect(() =>
      validateHumanReviewWorkflowLinkage({ queueItem, decision }),
    ).toThrow(/carry forward receipt .* with the same digest/i);
  });

  it("rejects a broken queue-to-decision audit link", () => {
    const queueItem = readFixture("false-positive-queue-item.json");
    const decision = readFixture("false-positive-decision.json");
    const audit = decision.audit as Record<string, unknown>;
    audit.previous_event_digest = `sha256:${"0".repeat(64)}`;

    expect(() =>
      validateHumanReviewWorkflowLinkage({ queueItem, decision }),
    ).toThrow(/must reference the queue event digest/i);
  });

  it("rejects an escalated review without its incident artifact", () => {
    const queueItem = readFixture("escalated-queue-item.json");
    const decision = readFixture("escalated-decision.json");

    expect(() =>
      validateHumanReviewWorkflowLinkage({ queueItem, decision }),
    ).toThrow(/requires an incident artifact/i);
  });

  it("rejects an incident attached to a non-escalated decision", () => {
    const queueItem = readFixture("false-positive-queue-item.json");
    const decision = readFixture("false-positive-decision.json");
    const incident = readFixture("example-incident.json");

    expect(() =>
      validateHumanReviewWorkflowLinkage({ queueItem, decision, incident }),
    ).toThrow(/requires an escalated review decision/i);
  });

  it("rejects an escalation missing its incident reference", () => {
    const decision = readFixture("escalated-decision.json");
    const escalation = decision.escalation as Record<string, unknown>;
    escalation.incident_id = null;

    expect(() => validateHumanReviewDecision(decision)).toThrow(
      /requires an incident id and reason/i,
    );
  });

  it("rejects an incident timeline that is not chronological", () => {
    const incident = readFixture("example-incident.json");
    const timeline = incident.timeline as Array<Record<string, unknown>>;
    timeline[1].occurred_at = "2026-07-09T14:10:00.000Z";

    expect(() => validateIncidentReport(incident)).toThrow(/chronological/i);
  });

  it("requires complete closure evidence for resolved incidents", () => {
    const incident = readFixture("example-incident.json");
    incident.status = "resolved";

    expect(() => validateIncidentReport(incident)).toThrow(
      /require complete closure evidence/i,
    );
  });

  it("rejects raw review content and duplicate receipt references", () => {
    const queueItem = readFixture("false-positive-queue-item.json");
    const privacy = queueItem.privacy as Record<string, unknown>;
    privacy.raw_content_included = true;
    const references = queueItem.receipt_references as unknown[];
    references.push(structuredClone(references[0]));

    expect(() => validateHumanReviewQueueItem(queueItem)).toThrow();
  });

  it("keeps all three JSON Schemas closed to undeclared top-level fields", () => {
    for (const name of [
      "human-review-queue-item.schema.json",
      "human-review-decision.schema.json",
      "incident-report.schema.json",
    ]) {
      const schema = JSON.parse(
        readFileSync(`schemas/research/${name}`, "utf8"),
      ) as { additionalProperties: boolean };
      expect(schema.additionalProperties, name).toBe(false);
    }
  });
});
