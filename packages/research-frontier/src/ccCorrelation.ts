import {
  type GuardrailObservation,
  validateGuardrailObservation
} from "./guardrailObservation";

export const ccFailureSemantics = "1 means guardrail failure or unsafe pass" as const;

export interface DiscretizationRuleReceipt {
  schema_version: "ghost.discretization_rule_receipt.v1";
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
  failure_semantics: typeof ccFailureSemantics;
  calibration_digest: string;
  scoring_function_digest: string;
  policy_digest: string;
  model_or_classifier_digest: string;
  valid_from: string;
  valid_until: string | null;
  canonicalization: "json-canonical-v1";
  receipt_digest: string;
  non_claim: string;
}

export interface CcBinaryObservation {
  schema_version: "ghost.cc_binary_observation.v1";
  observation_id: string;
  execution_receipt_id: string;
  execution_receipt_digest?: string;
  source_guardrail_observation_id?: string;
  discretization_rule_id: string;
  discretization_rule_digest: string;
  variable_id: string;
  score_name: string;
  score_value: number;
  binary_value: 0 | 1;
  failure_semantics: typeof ccFailureSemantics;
  observed_at: string;
  parent_trace_digest: string;
  cohort_id: string;
  copula_stationarity: {
    declared: boolean;
    scope: string;
    non_claim: string;
  };
  non_claim: string;
}

export interface ProportionInterval {
  method: "wilson-score";
  confidence_level: 0.95;
  lower: number;
  upper: number;
}

export interface CcVariableSummary {
  variable_id: string;
  failure_count: number;
  failure_rate: number;
  failure_rate_interval: ProportionInterval;
}

export interface CcPairwiseSummary {
  left_variable_id: string;
  right_variable_id: string;
  co_failure_table: {
    n00: number;
    n01: number;
    n10: number;
    n11: number;
  };
  observed_joint_failure_rate: number;
  joint_failure_interval: ProportionInterval;
  frechet_bounds: {
    lower: number;
    upper: number;
    interpretation: string;
  };
  phi_correlation: number | null;
}

export interface CcCorrelationReport {
  schema_version: "ghost.cc_correlation_report.v1";
  generated_at: string;
  cohort_id: string;
  sample_size: number;
  variable_summaries: CcVariableSummary[];
  pairwise_summaries: CcPairwiseSummary[];
  dependence_model: {
    kind: "empirical-pairwise";
    missingness_policy: "complete-grid-required";
    stationarity_declaration: string;
  };
  warnings: string[];
  non_claims: string[];
}

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!digestPattern.test(value)) {
    throw new Error(`${label} must be a sha256-prefixed lowercase digest`);
  }
}

function compare(score: number, comparator: DiscretizationRuleReceipt["comparator"], threshold: number): boolean {
  if (comparator === ">=") return score >= threshold;
  if (comparator === ">") return score > threshold;
  if (comparator === "<=") return score <= threshold;
  return score < threshold;
}

export function validateDiscretizationRuleReceipt(value: DiscretizationRuleReceipt): DiscretizationRuleReceipt {
  if (!value || value.schema_version !== "ghost.discretization_rule_receipt.v1") {
    throw new Error("Discretization rule schema_version is unsupported");
  }
  assertNonEmpty(value.rule_id, "rule_id");
  assertNonEmpty(value.guardrail_id, "guardrail_id");
  assertNonEmpty(value.score_name, "score_name");
  if (
    value.score_domain.type !== "closed_interval" ||
    !Number.isFinite(value.score_domain.lower) ||
    !Number.isFinite(value.score_domain.upper) ||
    value.score_domain.lower >= value.score_domain.upper
  ) {
    throw new Error("score_domain must be a finite, increasing closed interval");
  }
  if (
    !Number.isFinite(value.threshold) ||
    value.threshold < value.score_domain.lower ||
    value.threshold > value.score_domain.upper
  ) {
    throw new Error("threshold must be inside score_domain");
  }
  const inclusiveComparator = value.comparator === ">=" || value.comparator === "<=";
  if (value.threshold_inclusive !== inclusiveComparator) {
    throw new Error("threshold_inclusive must match the comparator");
  }
  if (
    (value.score_polarity === "higher_is_riskier" && ![">=", ">"].includes(value.comparator)) ||
    (value.score_polarity === "lower_is_riskier" && !["<=", "<"].includes(value.comparator))
  ) {
    throw new Error("comparator violates the monotonic risk invariant");
  }
  if (value.failure_semantics !== ccFailureSemantics) {
    throw new Error(`failure_semantics must be '${ccFailureSemantics}'`);
  }
  for (const [label, digest] of [
    ["calibration_digest", value.calibration_digest],
    ["scoring_function_digest", value.scoring_function_digest],
    ["policy_digest", value.policy_digest],
    ["model_or_classifier_digest", value.model_or_classifier_digest],
    ["receipt_digest", value.receipt_digest]
  ] as const) {
    assertDigest(digest, label);
  }
  const validFrom = Date.parse(value.valid_from);
  const validUntil = value.valid_until === null ? Number.POSITIVE_INFINITY : Date.parse(value.valid_until);
  if (!Number.isFinite(validFrom) || (value.valid_until !== null && !Number.isFinite(validUntil))) {
    throw new Error("Discretization validity bounds must be date-times");
  }
  if (validUntil <= validFrom) {
    throw new Error("valid_until must be later than valid_from");
  }
  if (value.canonicalization !== "json-canonical-v1") {
    throw new Error("Discretization canonicalization is unsupported");
  }
  assertNonEmpty(value.non_claim, "non_claim");
  return value;
}

export function adaptGuardrailObservationToCc(input: {
  observation: GuardrailObservation;
  rule: DiscretizationRuleReceipt;
  cohortId: string;
  variableId?: string;
  stationarityScope: string;
}): CcBinaryObservation {
  const observation = validateGuardrailObservation(input.observation);
  const rule = validateDiscretizationRuleReceipt(input.rule);
  assertNonEmpty(input.cohortId, "cohortId");
  assertNonEmpty(input.stationarityScope, "stationarityScope");

  if (observation.guardrail.guardrail_id !== rule.guardrail_id) {
    throw new Error("Guardrail observation does not match the discretization rule guardrail_id");
  }
  if (
    observation.receipt_binding.status !== "declared_reference" ||
    observation.receipt_binding.receipt_id === null ||
    observation.receipt_binding.receipt_digest === null
  ) {
    throw new Error("CC export requires a declared receipt reference; an unbound observation fails closed");
  }

  const score = observation.result.scores.find((candidate) => candidate.name === rule.score_name);
  if (!score) {
    throw new Error(`Guardrail observation is missing score ${rule.score_name}`);
  }
  if (score.value < rule.score_domain.lower || score.value > rule.score_domain.upper) {
    throw new Error(`Guardrail score ${rule.score_name} is outside the discretization rule domain`);
  }

  const observedAt = Date.parse(observation.observed_at);
  const validFrom = Date.parse(rule.valid_from);
  const validUntil = rule.valid_until === null ? Number.POSITIVE_INFINITY : Date.parse(rule.valid_until);
  if (!Number.isFinite(observedAt) || observedAt < validFrom || observedAt >= validUntil) {
    throw new Error("Guardrail observation is outside the discretization rule validity window");
  }

  return {
    schema_version: "ghost.cc_binary_observation.v1",
    observation_id: `cc_${observation.observation_id}_${rule.rule_id}`,
    source_guardrail_observation_id: observation.observation_id,
    execution_receipt_id: observation.receipt_binding.receipt_id,
    execution_receipt_digest: observation.receipt_binding.receipt_digest,
    discretization_rule_id: rule.rule_id,
    discretization_rule_digest: rule.receipt_digest,
    variable_id: input.variableId ?? `Z_${rule.guardrail_id}`,
    score_name: rule.score_name,
    score_value: score.value,
    binary_value: compare(score.value, rule.comparator, rule.threshold) ? 1 : 0,
    failure_semantics: ccFailureSemantics,
    observed_at: observation.observed_at,
    parent_trace_digest: observation.receipt_binding.receipt_digest,
    cohort_id: input.cohortId,
    copula_stationarity: {
      declared: true,
      scope: input.stationarityScope,
      non_claim: "Stationarity is declared for analysis scoping; this adapter does not validate distribution stability."
    },
    non_claim:
      "This observation records deterministic discretization mechanics. It does not validate the guardrail, calibration, threshold, dependence assumption, or model behavior."
  };
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

export function wilsonScoreInterval(successes: number, total: number): ProportionInterval {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new Error("Wilson interval counts must satisfy 0 <= successes <= total and total > 0");
  }
  const z = 1.959963984540054;
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((proportion * (1 - proportion)) / total + zSquared / (4 * total * total));
  return {
    method: "wilson-score",
    confidence_level: 0.95,
    lower: round(Math.max(0, center - margin)),
    upper: round(Math.min(1, center + margin))
  };
}

function validateBinaryObservation(observation: CcBinaryObservation): void {
  if (observation.schema_version !== "ghost.cc_binary_observation.v1") {
    throw new Error("CC binary observation schema_version is unsupported");
  }
  for (const [label, value] of [
    ["observation_id", observation.observation_id],
    ["execution_receipt_id", observation.execution_receipt_id],
    ["discretization_rule_id", observation.discretization_rule_id],
    ["variable_id", observation.variable_id],
    ["cohort_id", observation.cohort_id]
  ] as const) {
    assertNonEmpty(value, label);
  }
  assertDigest(observation.discretization_rule_digest, "discretization_rule_digest");
  assertDigest(observation.parent_trace_digest, "parent_trace_digest");
  if (observation.execution_receipt_digest !== undefined) {
    assertDigest(observation.execution_receipt_digest, "execution_receipt_digest");
  }
  if (observation.binary_value !== 0 && observation.binary_value !== 1) {
    throw new Error("binary_value must be exactly 0 or 1");
  }
  if (observation.failure_semantics !== ccFailureSemantics) {
    throw new Error("CC binary observation has unsupported failure semantics");
  }
  if (!Number.isFinite(observation.score_value) || !Number.isFinite(Date.parse(observation.observed_at))) {
    throw new Error("CC binary observation score and observed_at must be finite/parseable");
  }
  if (!observation.copula_stationarity.declared) {
    throw new Error("CC binary observation requires an explicit stationarity declaration");
  }
  assertNonEmpty(observation.copula_stationarity.scope, "copula_stationarity.scope");
  assertNonEmpty(observation.copula_stationarity.non_claim, "copula_stationarity.non_claim");
  assertNonEmpty(observation.non_claim, "non_claim");
}

export function analyzeCcBinaryCohort(input: {
  observations: CcBinaryObservation[];
  generatedAt: string;
}): CcCorrelationReport {
  if (!Number.isFinite(Date.parse(input.generatedAt))) {
    throw new Error("generatedAt must be a date-time");
  }
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    throw new Error("CC correlation analysis requires observations");
  }
  input.observations.forEach(validateBinaryObservation);

  const cohortIds = new Set(input.observations.map((observation) => observation.cohort_id));
  if (cohortIds.size !== 1) {
    throw new Error("All CC binary observations must belong to one cohort");
  }
  const variableIds = [...new Set(input.observations.map((observation) => observation.variable_id))].sort();
  if (variableIds.length < 2) {
    throw new Error("CC correlation analysis requires at least two variables");
  }

  const executions = new Map<string, Map<string, CcBinaryObservation>>();
  for (const observation of input.observations) {
    const variables = executions.get(observation.execution_receipt_id) ?? new Map<string, CcBinaryObservation>();
    if (variables.has(observation.variable_id)) {
      throw new Error(
        `Duplicate variable ${observation.variable_id} for execution ${observation.execution_receipt_id}`
      );
    }
    variables.set(observation.variable_id, observation);
    executions.set(observation.execution_receipt_id, variables);
  }
  for (const [executionId, variables] of executions.entries()) {
    const missing = variableIds.filter((variableId) => !variables.has(variableId));
    if (missing.length > 0) {
      throw new Error(`Execution ${executionId} is missing variables: ${missing.join(", ")}`);
    }
  }

  const sampleSize = executions.size;
  const variableSummaries: CcVariableSummary[] = variableIds.map((variableId) => {
    const failureCount = [...executions.values()].filter(
      (variables) => variables.get(variableId)?.binary_value === 1
    ).length;
    return {
      variable_id: variableId,
      failure_count: failureCount,
      failure_rate: round(failureCount / sampleSize),
      failure_rate_interval: wilsonScoreInterval(failureCount, sampleSize)
    };
  });

  const pairwiseSummaries: CcPairwiseSummary[] = [];
  for (let leftIndex = 0; leftIndex < variableIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < variableIds.length; rightIndex += 1) {
      const leftVariableId = variableIds[leftIndex];
      const rightVariableId = variableIds[rightIndex];
      const table = { n00: 0, n01: 0, n10: 0, n11: 0 };
      for (const variables of executions.values()) {
        const left = variables.get(leftVariableId)?.binary_value;
        const right = variables.get(rightVariableId)?.binary_value;
        if (left === 0 && right === 0) table.n00 += 1;
        else if (left === 0 && right === 1) table.n01 += 1;
        else if (left === 1 && right === 0) table.n10 += 1;
        else if (left === 1 && right === 1) table.n11 += 1;
      }

      const leftFailures = table.n10 + table.n11;
      const rightFailures = table.n01 + table.n11;
      const leftRate = leftFailures / sampleSize;
      const rightRate = rightFailures / sampleSize;
      const denominator = Math.sqrt(
        (table.n10 + table.n11) *
          (table.n00 + table.n01) *
          (table.n01 + table.n11) *
          (table.n00 + table.n10)
      );
      pairwiseSummaries.push({
        left_variable_id: leftVariableId,
        right_variable_id: rightVariableId,
        co_failure_table: table,
        observed_joint_failure_rate: round(table.n11 / sampleSize),
        joint_failure_interval: wilsonScoreInterval(table.n11, sampleSize),
        frechet_bounds: {
          lower: round(Math.max(0, leftRate + rightRate - 1)),
          upper: round(Math.min(leftRate, rightRate)),
          interpretation:
            "These are logical bounds from the observed marginals; they do not identify the true dependence structure."
        },
        phi_correlation: denominator === 0 ? null : round((table.n11 * table.n00 - table.n10 * table.n01) / denominator)
      });
    }
  }

  const stationarityScopes = [...new Set(input.observations.map((item) => item.copula_stationarity.scope))].sort();
  return {
    schema_version: "ghost.cc_correlation_report.v1",
    generated_at: input.generatedAt,
    cohort_id: [...cohortIds][0],
    sample_size: sampleSize,
    variable_summaries: variableSummaries,
    pairwise_summaries: pairwiseSummaries,
    dependence_model: {
      kind: "empirical-pairwise",
      missingness_policy: "complete-grid-required",
      stationarity_declaration: stationarityScopes.join("; ")
    },
    warnings: [
      "Stationarity is declared by the producer and is not statistically established by this report.",
      "Wilson intervals describe finite-sample proportion uncertainty only; they do not cover upstream scoring, sampling, or dependence-model error."
    ],
    non_claims: [
      "This report does not establish causal dependence, calibration validity, cohort representativeness, threshold quality, AI safety, or compliance.",
      "Frechet bounds constrain possible joint rates under the observed marginals; they do not choose a copula or predict future behavior."
    ]
  };
}
