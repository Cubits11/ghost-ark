import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type DiscretizationRule = {
  schema_version: string;
  rule_id: string;
  guardrail_id: string;
  score_name: string;
  score_domain: {
    type: "closed_interval";
    lower: number;
    upper: number;
  };
  score_polarity: "higher_is_riskier" | "lower_is_riskier";
  comparator: ">=" | ">" | "<=" | "<";
  threshold: number;
  threshold_inclusive: boolean;
  failure_semantics: string;
  calibration_digest: string;
  scoring_function_digest: string;
  policy_digest: string;
  model_or_classifier_digest: string;
  valid_from: string;
  valid_until: string | null;
  canonicalization: string;
  receipt_digest: string;
  non_claim: string;
};

type BinaryObservation = {
  schema_version: string;
  observation_id: string;
  execution_receipt_id: string;
  discretization_rule_id: string;
  discretization_rule_digest: string;
  variable_id: string;
  score_name: string;
  score_value: number;
  binary_value: 0 | 1;
  failure_semantics: string;
  observed_at: string;
  parent_trace_digest: string;
  cohort_id: string;
  copula_stationarity: {
    declared: boolean;
    scope: string;
    non_claim: string;
  };
  non_claim: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function compare(score: number, comparator: DiscretizationRule["comparator"], threshold: number): boolean {
  if (comparator === ">=") return score >= threshold;
  if (comparator === ">") return score > threshold;
  if (comparator === "<=") return score <= threshold;
  return score < threshold;
}

function assertDigest(value: string): void {
  expect(value).toMatch(/^sha256:[a-f0-9]{64}$/);
}

function assertRulePreconditions(rule: DiscretizationRule): void {
  expect(rule.schema_version).toBe("ghost.discretization_rule_receipt.v1");
  expect(rule.score_domain.type).toBe("closed_interval");
  expect(Number.isFinite(rule.score_domain.lower)).toBe(true);
  expect(Number.isFinite(rule.score_domain.upper)).toBe(true);
  expect(rule.score_domain.lower).toBeLessThan(rule.score_domain.upper);
  expect(rule.threshold).toBeGreaterThanOrEqual(rule.score_domain.lower);
  expect(rule.threshold).toBeLessThanOrEqual(rule.score_domain.upper);
  expect(rule.failure_semantics).toBe("1 means guardrail failure or unsafe pass");

  assertDigest(rule.calibration_digest);
  assertDigest(rule.scoring_function_digest);
  assertDigest(rule.policy_digest);
  assertDigest(rule.model_or_classifier_digest);
  assertDigest(rule.receipt_digest);

  if (rule.score_polarity === "higher_is_riskier") {
    expect([">=", ">"]).toContain(rule.comparator);
  }

  if (rule.score_polarity === "lower_is_riskier") {
    expect(["<=", "<"]).toContain(rule.comparator);
  }

  expect(rule.canonicalization).toBe("json-canonical-v1");
  expect(rule.non_claim).toContain("does not prove");
}

function assertObservationMatchesRule(rule: DiscretizationRule, observation: BinaryObservation): void {
  expect(observation.schema_version).toBe("ghost.cc_binary_observation.v1");
  expect(observation.discretization_rule_id).toBe(rule.rule_id);
  expect(observation.discretization_rule_digest).toBe(rule.receipt_digest);
  expect(observation.score_name).toBe(rule.score_name);
  expect(observation.failure_semantics).toBe(rule.failure_semantics);
  expect(observation.binary_value === 0 || observation.binary_value === 1).toBe(true);

  expect(observation.score_value).toBeGreaterThanOrEqual(rule.score_domain.lower);
  expect(observation.score_value).toBeLessThanOrEqual(rule.score_domain.upper);

  const expectedBinaryValue = compare(observation.score_value, rule.comparator, rule.threshold) ? 1 : 0;
  expect(observation.binary_value).toBe(expectedBinaryValue);

  const observedAt = Date.parse(observation.observed_at);
  const validFrom = Date.parse(rule.valid_from);
  expect(Number.isFinite(observedAt)).toBe(true);
  expect(observedAt).toBeGreaterThanOrEqual(validFrom);

  if (rule.valid_until !== null) {
    expect(observedAt).toBeLessThanOrEqual(Date.parse(rule.valid_until));
  }

  assertDigest(observation.parent_trace_digest);
  expect(observation.execution_receipt_id).toMatch(/^rct_/);
  expect(observation.copula_stationarity.declared).toBe(true);
  expect(observation.non_claim).toContain("does not validate");
}

describe("CC Ghost discretization contract", () => {
  it("defines a monotonic receipt-bound mapping from score to CC binary variable", () => {
    const rule = readJson<DiscretizationRule>("examples/cc-ghost/discretization-rule-receipt.example.json");
    const observation = readJson<BinaryObservation>("examples/cc-ghost/binary-observation.example.json");

    assertRulePreconditions(rule);
    assertObservationMatchesRule(rule, observation);
  });

  it("fails closed for comparator polarity that violates the monotonic risk invariant", () => {
    const rule = readJson<DiscretizationRule>("examples/cc-ghost/discretization-rule-receipt.example.json");
    const invalidRule: DiscretizationRule = {
      ...rule,
      comparator: "<="
    };

    expect(() => assertRulePreconditions(invalidRule)).toThrow();
  });

  it("fails closed when the binary observation does not match the signed threshold rule", () => {
    const rule = readJson<DiscretizationRule>("examples/cc-ghost/discretization-rule-receipt.example.json");
    const observation = readJson<BinaryObservation>("examples/cc-ghost/binary-observation.example.json");
    const invalidObservation: BinaryObservation = {
      ...observation,
      binary_value: 0
    };

    expect(() => assertObservationMatchesRule(rule, invalidObservation)).toThrow();
  });
});