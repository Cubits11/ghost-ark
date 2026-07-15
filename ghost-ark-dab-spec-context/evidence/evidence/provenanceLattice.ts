import { ValidationError } from "../../../shared/src/errors";

/**
 * Evidence provenance lattice (v1).
 *
 * Provenance classes rank evidence by who must be compromised to fabricate it
 * under the stated assumptions in docs/research/EVIDENCE_PROVENANCE_LATTICE.md.
 * They say nothing about whether the evidence content is true.
 *
 * The v1 order is a total chain (every chain is a lattice):
 *
 *   AGENT_ASSERTED < GATEWAY_RECORDED < SOURCE_SIGNED < CROSS_WITNESSED < EXTERNALLY_ATTESTED
 *
 * CROSS_WITNESSED is derive-only: it is computed from agreeing independent
 * records and may never be assigned directly to a single element, so an agent
 * cannot label its own assertion as cross-witnessed.
 */

export const evidenceProvenanceSchemaVersion = "ghost.evidence_provenance.v1" as const;

export const provenanceClasses = [
  "AGENT_ASSERTED",
  "GATEWAY_RECORDED",
  "SOURCE_SIGNED",
  "CROSS_WITNESSED",
  "EXTERNALLY_ATTESTED"
] as const;

export type ProvenanceClass = (typeof provenanceClasses)[number];

const deriveOnlyClasses: ReadonlySet<ProvenanceClass> = new Set(["CROSS_WITNESSED"]);

const provenanceRankByClass: Record<ProvenanceClass, number> = {
  AGENT_ASSERTED: 0,
  GATEWAY_RECORDED: 1,
  SOURCE_SIGNED: 2,
  CROSS_WITNESSED: 3,
  EXTERNALLY_ATTESTED: 4
};

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;
const identifierPattern = /^[A-Za-z0-9._:-]{1,256}$/u;

export interface ProvenanceLabeledEvidence {
  evidenceId: string;
  contentDigest: string;
  sourceId: string;
  provenanceClass: ProvenanceClass;
}

export interface EvidenceFloorRequirement {
  effectClass: string;
  floor: ProvenanceClass;
  minimumDistinctSources: number;
}

export interface EvidenceFloorEvaluation {
  satisfied: boolean;
  qualifyingSourceIds: string[];
  detail: string;
}

export interface VacuityFinding {
  vacuous: boolean;
  reason: string;
}

function provenanceError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.evidence_provenance.v1", ...context });
}

export function assertProvenanceClass(value: unknown): asserts value is ProvenanceClass {
  if (typeof value !== "string" || !(value in provenanceRankByClass)) {
    // Unknown labels fail closed: an unrecognized class is never treated as any rank.
    throw provenanceError("Unknown evidence provenance class.", { observed: value });
  }
}

export function assertAssignableProvenanceClass(value: unknown): asserts value is ProvenanceClass {
  assertProvenanceClass(value);
  if (deriveOnlyClasses.has(value)) {
    throw provenanceError("Provenance class is derive-only and cannot be assigned to a single evidence element.", {
      observed: value
    });
  }
}

export function provenanceRank(value: ProvenanceClass): number {
  assertProvenanceClass(value);
  return provenanceRankByClass[value];
}

export function compareProvenance(a: ProvenanceClass, b: ProvenanceClass): -1 | 0 | 1 {
  const delta = provenanceRank(a) - provenanceRank(b);
  return delta < 0 ? -1 : delta > 0 ? 1 : 0;
}

export function joinProvenance(a: ProvenanceClass, b: ProvenanceClass): ProvenanceClass {
  return compareProvenance(a, b) >= 0 ? a : b;
}

export function meetProvenance(a: ProvenanceClass, b: ProvenanceClass): ProvenanceClass {
  return compareProvenance(a, b) <= 0 ? a : b;
}

export function meetsProvenanceFloor(observed: ProvenanceClass, floor: ProvenanceClass): boolean {
  return provenanceRank(observed) >= provenanceRank(floor);
}

/**
 * No-laundering admission rule for delegated evidence.
 *
 * When evidence crosses an agent-to-agent delegation hop, the receiving
 * boundary admits it at the meet of the claimed class and the class the
 * receiving boundary independently re-verified. The admitted class never
 * exceeds either input, so provenance rank is non-increasing across hops.
 */
export function admitDelegatedEvidence(input: {
  claimedClass: ProvenanceClass;
  reverifiedClass: ProvenanceClass;
}): ProvenanceClass {
  assertProvenanceClass(input.claimedClass);
  assertAssignableProvenanceClass(input.reverifiedClass);
  return meetProvenance(input.claimedClass, input.reverifiedClass);
}

function assertEvidenceShape(element: ProvenanceLabeledEvidence, index: number): void {
  if (!element || typeof element !== "object") {
    throw provenanceError("Evidence element must be an object.", { index });
  }
  if (typeof element.evidenceId !== "string" || !identifierPattern.test(element.evidenceId)) {
    throw provenanceError("Evidence element evidenceId must be 1-256 characters of URL-safe text.", { index });
  }
  if (typeof element.sourceId !== "string" || !identifierPattern.test(element.sourceId)) {
    throw provenanceError("Evidence element sourceId must be 1-256 characters of URL-safe text.", { index });
  }
  if (typeof element.contentDigest !== "string" || !sha256DigestPattern.test(element.contentDigest)) {
    throw provenanceError("Evidence element contentDigest must be a sha256:<hex> digest.", { index });
  }
  assertProvenanceClass(element.provenanceClass);
}

/**
 * Derive the aggregate provenance class of a set of records that all commit
 * to the same content digest.
 *
 * The aggregate is the join of the individual classes, upgraded to
 * CROSS_WITNESSED when at least two distinct sources at SOURCE_SIGNED or
 * above agree on the identical digest. Agreement among agent assertions or a
 * single repeated source never upgrades.
 */
export function deriveAggregateClass(elements: ProvenanceLabeledEvidence[]): ProvenanceClass {
  if (!Array.isArray(elements) || elements.length === 0) {
    throw provenanceError("Aggregate provenance requires at least one evidence element.");
  }
  elements.forEach((element, index) => {
    assertEvidenceShape(element, index);
    if (deriveOnlyClasses.has(element.provenanceClass)) {
      throw provenanceError("Individual evidence elements cannot carry a derive-only provenance class.", { index });
    }
  });

  const digests = new Set(elements.map((element) => element.contentDigest));
  if (digests.size !== 1) {
    throw provenanceError("Aggregate provenance requires all elements to commit to the same content digest.", {
      observedDigestCount: digests.size
    });
  }

  let aggregate = elements[0].provenanceClass;
  for (const element of elements.slice(1)) {
    aggregate = joinProvenance(aggregate, element.provenanceClass);
  }

  const independentSignedSources = new Set(
    elements
      .filter((element) => meetsProvenanceFloor(element.provenanceClass, "SOURCE_SIGNED"))
      .map((element) => element.sourceId)
  );
  if (independentSignedSources.size >= 2) {
    aggregate = joinProvenance(aggregate, "CROSS_WITNESSED");
  }

  return aggregate;
}

function assertRequirementShape(requirement: EvidenceFloorRequirement): void {
  if (!requirement || typeof requirement !== "object") {
    throw provenanceError("Evidence floor requirement must be an object.");
  }
  if (typeof requirement.effectClass !== "string" || !identifierPattern.test(requirement.effectClass)) {
    throw provenanceError("Requirement effectClass must be 1-256 characters of URL-safe text.");
  }
  assertProvenanceClass(requirement.floor);
  if (!Number.isSafeInteger(requirement.minimumDistinctSources) || requirement.minimumDistinctSources < 1) {
    throw provenanceError("Requirement minimumDistinctSources must be a positive safe integer.", {
      observed: requirement.minimumDistinctSources
    });
  }
}

/**
 * Evaluate whether an evidence set satisfies a provenance floor requirement.
 *
 * Elements below the floor never enter the qualifying set, so adding
 * below-floor elements cannot move an unsatisfied requirement to satisfied
 * (verdict monotonicity under provenance stratification).
 */
export function evaluateEvidenceFloor(
  elements: ProvenanceLabeledEvidence[],
  requirement: EvidenceFloorRequirement
): EvidenceFloorEvaluation {
  assertRequirementShape(requirement);
  if (!Array.isArray(elements)) {
    throw provenanceError("Evidence elements must be an array.");
  }
  elements.forEach((element, index) => assertEvidenceShape(element, index));

  const qualifyingSourceIds = [
    ...new Set(
      elements
        .filter((element) => meetsProvenanceFloor(element.provenanceClass, requirement.floor))
        .map((element) => element.sourceId)
    )
  ].sort();

  const satisfied = qualifyingSourceIds.length >= requirement.minimumDistinctSources;
  return {
    satisfied,
    qualifyingSourceIds,
    detail: satisfied
      ? `Requirement ${requirement.effectClass} met by ${qualifyingSourceIds.length} distinct source(s) at or above ${requirement.floor}.`
      : `Requirement ${requirement.effectClass} needs ${requirement.minimumDistinctSources} distinct source(s) at or above ${requirement.floor}; observed ${qualifyingSourceIds.length}.`
  };
}

/**
 * Static vacuity lint for policy requirements.
 *
 * A requirement whose floor is AGENT_ASSERTED authorizes effects on evidence
 * the agent can synthesize alone, so the floor adds no constraint beyond the
 * agent's own claim. Policy compilation should reject such requirements for
 * effectful actions.
 */
export function detectVacuousRequirement(requirement: EvidenceFloorRequirement): VacuityFinding {
  assertRequirementShape(requirement);
  if (requirement.floor === "AGENT_ASSERTED") {
    return {
      vacuous: true,
      reason: "Floor AGENT_ASSERTED is satisfiable by agent-synthesized evidence alone."
    };
  }
  return { vacuous: false, reason: "Floor requires evidence the agent cannot synthesize alone under stated assumptions." };
}
