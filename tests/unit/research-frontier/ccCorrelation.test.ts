import { describe, expect, it } from "vitest";
import type { GuardrailObservation } from "../../../packages/research-frontier/src/guardrailObservation";
import {
  adaptGuardrailObservationToCc,
  analyzeCcBinaryCohort,
  type CcBinaryObservation,
  type DiscretizationRuleReceipt,
  wilsonScoreInterval
} from "../../../packages/research-frontier/src/ccCorrelation";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const identityDigest = (character: string): string => `hmac-sha256:${character.repeat(64)}`;

function rule(guardrailId: string, scoreName: string, threshold: number, marker: string): DiscretizationRuleReceipt {
  return {
    schema_version: "ghost.discretization_rule_receipt.v1",
    rule_id: `${guardrailId}-rule-v1`,
    guardrail_id: guardrailId,
    score_name: scoreName,
    score_domain: { type: "closed_interval", lower: 0, upper: 1 },
    score_polarity: "higher_is_riskier",
    comparator: ">=",
    threshold,
    threshold_inclusive: true,
    failure_semantics: "1 means guardrail failure or unsafe pass",
    calibration_digest: digest(marker),
    scoring_function_digest: digest("2"),
    policy_digest: digest("3"),
    model_or_classifier_digest: digest("4"),
    valid_from: "2026-07-01T00:00:00.000Z",
    valid_until: null,
    canonicalization: "json-canonical-v1",
    receipt_digest: digest(marker),
    non_claim: "This fixture does not prove guardrail validity."
  };
}

function observation(execution: number, guardrailId: string, scoreName: string, score: number): GuardrailObservation {
  return {
    schema_version: "ghostark.research.guardrail_observation.v1",
    observation_id: `gobs_${execution}_${guardrailId}`,
    observed_at: `2026-07-0${execution + 1}T00:00:00.000Z`,
    scope: {
      tenant_id_hash: identityDigest("a"),
      request_id_hash: identityDigest(String(execution + 1))
    },
    guardrail: {
      guardrail_id: guardrailId,
      guardrail_version: "1",
      evaluation_stage: "post_model"
    },
    result: {
      outcome: score >= 0.5 ? "block" : "pass",
      action: score >= 0.5 ? "block" : "allow",
      scores: [{ name: scoreName, value: score, lower_bound: 0, upper_bound: 1 }],
      findings: []
    },
    content_evidence: {
      input_digest: digest("5"),
      output_digest: digest("6"),
      raw_content_included: false
    },
    privacy: {
      classification: "pseudonymous",
      redaction_applied: true,
      redaction_policy_id: "redact-v1",
      redaction_policy_digest: digest("7"),
      suppressed_fields: ["prompt", "completion"]
    },
    receipt_binding: {
      status: "declared_reference",
      receipt_id: `rct-execution-${execution}`,
      receipt_digest: digest(String(execution + 1))
    },
    telemetry: { trace_id: null, span_id: null },
    non_claims: ["This local observation does not prove model safety."]
  };
}

function buildCohort(): CcBinaryObservation[] {
  const values = [
    [0.9, 0.8],
    [0.9, 0.2],
    [0.1, 0.8],
    [0.1, 0.2]
  ];
  return values.flatMap(([left, right], execution) => [
    adaptGuardrailObservationToCc({
      observation: observation(execution, "toxicity", "toxicity_score", left),
      rule: rule("toxicity", "toxicity_score", 0.5, "8"),
      cohortId: "cohort-1",
      stationarityScope: "fixed local fixture"
    }),
    adaptGuardrailObservationToCc({
      observation: observation(execution, "pii", "pii_score", right),
      rule: rule("pii", "pii_score", 0.5, "9"),
      cohortId: "cohort-1",
      stationarityScope: "fixed local fixture"
    })
  ]);
}

describe("CC correlation adapter", () => {
  it("exports receipt-referenced guardrail scores as binary CC observations", () => {
    const exported = buildCohort()[0];

    expect(exported).toMatchObject({
      schema_version: "ghost.cc_binary_observation.v1",
      variable_id: "Z_toxicity",
      score_value: 0.9,
      binary_value: 1,
      failure_semantics: "1 means guardrail failure or unsafe pass"
    });
    expect(exported.execution_receipt_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("builds co-failure tables, empirical dependence metrics, Frechet bounds, and intervals", () => {
    const report = analyzeCcBinaryCohort({
      observations: buildCohort(),
      generatedAt: "2026-07-09T12:00:00.000Z"
    });

    expect(report.sample_size).toBe(4);
    expect(report.variable_summaries).toEqual([
      expect.objectContaining({ variable_id: "Z_pii", failure_count: 2, failure_rate: 0.5 }),
      expect.objectContaining({ variable_id: "Z_toxicity", failure_count: 2, failure_rate: 0.5 })
    ]);
    expect(report.pairwise_summaries[0]).toMatchObject({
      co_failure_table: { n00: 1, n01: 1, n10: 1, n11: 1 },
      observed_joint_failure_rate: 0.25,
      frechet_bounds: { lower: 0, upper: 0.5 },
      phi_correlation: 0
    });
    expect(report.pairwise_summaries[0].joint_failure_interval).toEqual(wilsonScoreInterval(1, 4));
  });

  it("fails closed for unbound observations and invalid rule polarity", () => {
    const unbound = observation(0, "toxicity", "toxicity_score", 0.9);
    unbound.receipt_binding = { status: "unbound", receipt_id: null, receipt_digest: null };
    expect(() =>
      adaptGuardrailObservationToCc({
        observation: unbound,
        rule: rule("toxicity", "toxicity_score", 0.5, "8"),
        cohortId: "cohort-1",
        stationarityScope: "local fixture"
      })
    ).toThrow(/unbound/u);

    expect(() =>
      adaptGuardrailObservationToCc({
        observation: observation(0, "toxicity", "toxicity_score", 0.9),
        rule: { ...rule("toxicity", "toxicity_score", 0.5, "8"), comparator: "<=" },
        cohortId: "cohort-1",
        stationarityScope: "local fixture"
      })
    ).toThrow(/monotonic/u);
  });

  it("rejects duplicate variables and incomplete execution grids", () => {
    const cohort = buildCohort();
    expect(() =>
      analyzeCcBinaryCohort({
        observations: [...cohort, cohort[0]],
        generatedAt: "2026-07-09T12:00:00.000Z"
      })
    ).toThrow(/Duplicate variable/u);
    expect(() =>
      analyzeCcBinaryCohort({
        observations: cohort.slice(1),
        generatedAt: "2026-07-09T12:00:00.000Z"
      })
    ).toThrow(/missing variables/u);
  });
});
