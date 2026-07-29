/**
 * E1 — Provenance kernel census.
 *
 * Question
 * --------
 * For a canonicalizer C and digest H, the kernel of the receipt-identity map is
 *
 *     ker(C) = { (x, y) : x != y as byte sequences, and H(C(parse(x))) = H(C(parse(y))) }
 *
 * A member of ker(C) is UNINTENDED when some declared consumer distinguishes x
 * from y. The dual defect is OVER-DISCRIMINATION: x and y land on different
 * digests while every declared consumer treats them as the same fact.
 *
 * This module measures both directions, per implementation, against intents
 * declared in kernelAlphabet.ts before any arm was run.
 *
 * What a verdict means
 * --------------------
 *   sound                 Behavior matches declared consumer intent.
 *   unintended-kernel     Collapsed a pair a consumer distinguishes. The receipt
 *                         cannot evidence a difference that matters downstream.
 *   over-discrimination   Split a pair every consumer unifies. Semantically
 *                         unchanged evidence fails re-verification.
 *   fail-closed           BOTH sides rejected. No false identity is issued. Counted
 *                         separately from `sound` because refusing input is an
 *                         availability cost even when it is the safe outcome.
 *   sound-by-rejection    One side admitted, one refused, intent "distinct". The two
 *                         documents do not share an identity — one has none. A consumer
 *                         can still tell them apart and no false shared identity was
 *                         issued. This is the goal state for admission control, reached
 *                         by refusal rather than by discrimination.
 *   rejection-asymmetry   One side admitted, one refused, intent "equivalent". Two
 *                         documents every consumer treats as one fact, and only one was
 *                         accepted. An availability failure and a real cost of a strict
 *                         rule, reported as such rather than counted as a win.
 *
 * NON-CLAIM: a `sound` verdict holds only for the declared consumer set and only
 * for the pairs in this alphabet. This experiment measures identifiability
 * structure. It says nothing about model safety, semantic truth, compliance, or
 * whether any receipt describes a real event.
 */

import { PATHOLOGY_ALPHABET, assertAlphabetWellFormed, type ConsumerIntent, type PathologyClass } from "./kernelAlphabet";
import { buildArms, probePython, type ArmOutcome, type CanonicalizerArm } from "./canonicalizerArms";

export const E1_REPORT_SCHEMA_VERSION = "ghost.e1_kernel_census.v1";

export type CensusVerdict =
  | "sound"
  | "unintended-kernel"
  | "over-discrimination"
  | "fail-closed"
  | "sound-by-rejection"
  | "rejection-asymmetry";

export interface CellResult {
  pathologyId: string;
  armId: string;
  intent: ConsumerIntent;
  /** "collapsed" | "distinct" | "rejected-both" | "rejected-one" */
  observed: "collapsed" | "distinct" | "rejected-both" | "rejected-one";
  verdict: CensusVerdict;
  digestA: string | null;
  digestB: string | null;
  rejectionReasonA: string | null;
  rejectionReasonB: string | null;
}

export interface ArmSummary {
  armId: string;
  independentParser: boolean;
  description: string;
  sound: number;
  unintendedKernel: number;
  overDiscrimination: number;
  failClosed: number;
  soundByRejection: number;
  rejectionAsymmetry: number;
  /** Ids of the pairs this arm collapsed against intent. The headline list. */
  unintendedKernelMembers: string[];
}

export interface E1Report {
  schema_version: typeof E1_REPORT_SCHEMA_VERSION;
  /** Curated, adversarial, not a random sample. Drives interval suppression downstream. */
  sample_provenance: "census";
  alphabet_size: number;
  arms: ArmSummary[];
  cells: CellResult[];
  /** Pairs collapsed against intent by EVERY arm that produced two digests. */
  universal_unintended_kernel: string[];
  /** Pairs where arms disagree — the cross-implementation divergences. */
  divergent_pathologies: string[];
  python_probe: { available: boolean; detail: string };
  non_claim: string;
}

const NON_CLAIM =
  "E1 measures the identifiability structure of a parse-canonicalize-digest pipeline over a hand-curated adversarial " +
  "alphabet, against a declared consumer set. It is not a random sample of real-world JSON and is not exhaustive. " +
  "A 'sound' verdict does not prove model safety, semantic truth, compliance, production readiness, or resistance to " +
  "attacks outside this alphabet. Absence of a pathology class here is not evidence of its absence in practice.";

function classify(intent: ConsumerIntent, outcomeA: ArmOutcome, outcomeB: ArmOutcome): { observed: CellResult["observed"]; verdict: CensusVerdict } {
  const aRejected = outcomeA.status === "rejected";
  const bRejected = outcomeB.status === "rejected";

  if (aRejected && bRejected) {
    return { observed: "rejected-both", verdict: "fail-closed" };
  }

  if (aRejected !== bRejected) {
    // One side admitted, one refused. The verdict depends entirely on intent, and
    // collapsing both cases into one label would misreport the mitigation arm.
    //
    // intent "distinct": the two documents do NOT share an identity — one has none at
    // all. A consumer can still tell them apart, and no false shared identity was
    // issued. That is the goal state for admission control, reached by refusal rather
    // than by discrimination.
    //
    // intent "equivalent": two documents every consumer treats as one fact, and the
    // system accepted only one of them. That is an availability failure, and it is a
    // real cost of a strict rule, not a win.
    return {
      observed: "rejected-one",
      verdict: intent === "distinct" ? "sound-by-rejection" : "rejection-asymmetry"
    };
  }

  const collapsed = (outcomeA as { digest: string }).digest === (outcomeB as { digest: string }).digest;

  if (collapsed) {
    return { observed: "collapsed", verdict: intent === "distinct" ? "unintended-kernel" : "sound" };
  }
  return { observed: "distinct", verdict: intent === "equivalent" ? "over-discrimination" : "sound" };
}

function cellFor(pathology: PathologyClass, arm: CanonicalizerArm): CellResult {
  const outcomeA = arm.run(pathology.rawA);
  const outcomeB = arm.run(pathology.rawB);
  const { observed, verdict } = classify(pathology.intent, outcomeA, outcomeB);

  return {
    pathologyId: pathology.id,
    armId: arm.id,
    intent: pathology.intent,
    observed,
    verdict,
    digestA: outcomeA.status === "digest" ? outcomeA.digest : null,
    digestB: outcomeB.status === "digest" ? outcomeB.digest : null,
    rejectionReasonA: outcomeA.status === "rejected" ? outcomeA.reason : null,
    rejectionReasonB: outcomeB.status === "rejected" ? outcomeB.reason : null
  };
}

export async function runE1Census(alphabet: readonly PathologyClass[] = PATHOLOGY_ALPHABET): Promise<E1Report> {
  assertAlphabetWellFormed(alphabet);

  const arms = await buildArms();
  const cells: CellResult[] = [];

  for (const pathology of alphabet) {
    for (const arm of arms) {
      cells.push(cellFor(pathology, arm));
    }
  }

  const armSummaries: ArmSummary[] = arms.map((arm) => {
    const armCells = cells.filter((cell) => cell.armId === arm.id);
    return {
      armId: arm.id,
      independentParser: arm.independentParser,
      description: arm.description,
      sound: armCells.filter((cell) => cell.verdict === "sound").length,
      unintendedKernel: armCells.filter((cell) => cell.verdict === "unintended-kernel").length,
      overDiscrimination: armCells.filter((cell) => cell.verdict === "over-discrimination").length,
      failClosed: armCells.filter((cell) => cell.verdict === "fail-closed").length,
      soundByRejection: armCells.filter((cell) => cell.verdict === "sound-by-rejection").length,
      rejectionAsymmetry: armCells.filter((cell) => cell.verdict === "rejection-asymmetry").length,
      unintendedKernelMembers: armCells.filter((cell) => cell.verdict === "unintended-kernel").map((cell) => cell.pathologyId)
    };
  });

  // A pathology is a UNIVERSAL unintended kernel member when every arm that
  // produced two digests for it collapsed them against intent. These are the
  // findings that cannot be blamed on one implementation's choices.
  //
  // At least two deciding arms are required. With one deciding arm, "every
  // deciding arm agrees" is a statement about a single implementation and would
  // overstate generality — `non-finite-overflow` is exactly that case, where three
  // arms fail closed and only the naive control produces digests.
  const MIN_DECIDING_ARMS_FOR_UNIVERSAL = 2;
  const universal: string[] = [];
  const divergent: string[] = [];

  for (const pathology of alphabet) {
    const pathologyCells = cells.filter((cell) => cell.pathologyId === pathology.id);
    const decided = pathologyCells.filter((cell) => cell.observed === "collapsed" || cell.observed === "distinct");

    if (decided.length >= MIN_DECIDING_ARMS_FOR_UNIVERSAL && decided.every((cell) => cell.verdict === "unintended-kernel")) {
      universal.push(pathology.id);
    }

    const verdictSet = new Set(pathologyCells.map((cell) => cell.verdict));
    if (verdictSet.size > 1) {
      divergent.push(pathology.id);
    }
  }

  return {
    schema_version: E1_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    alphabet_size: alphabet.length,
    arms: armSummaries,
    cells,
    universal_unintended_kernel: universal,
    divergent_pathologies: divergent,
    python_probe: probePython(),
    non_claim: NON_CLAIM
  };
}

/** CLI: `npx ts-node tools/experiments/e1KernelCensus.ts [--json]` */
async function main(): Promise<void> {
  const report = await runE1Census();
  const jsonOnly = process.argv.includes("--json");

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E1 provenance kernel census (${report.schema_version})`);
  lines.push(`alphabet: ${report.alphabet_size} pathology classes | provenance: ${report.sample_provenance} (no confidence intervals)`);
  lines.push(`python arm: ${report.python_probe.available ? report.python_probe.detail : `UNAVAILABLE (${report.python_probe.detail})`}`);
  lines.push("");
  lines.push("arm                              indep-parser  sound  UNINTENDED-KERNEL  over-discrim  fail-closed  sound-by-rej  rej-asym");
  for (const arm of report.arms) {
    lines.push(
      `${arm.armId.padEnd(32)} ${String(arm.independentParser).padEnd(13)} ${String(arm.sound).padEnd(6)} ${String(arm.unintendedKernel).padEnd(18)} ${String(arm.overDiscrimination).padEnd(13)} ${String(arm.failClosed).padEnd(12)} ${String(arm.soundByRejection).padEnd(13)} ${arm.rejectionAsymmetry}`
    );
  }
  lines.push("");
  lines.push(`universal unintended kernel members (collapsed against intent by every deciding arm): ${report.universal_unintended_kernel.length}`);
  for (const id of report.universal_unintended_kernel) {
    lines.push(`  - ${id}`);
  }
  lines.push("");
  lines.push(`cross-implementation divergences: ${report.divergent_pathologies.length}`);
  for (const id of report.divergent_pathologies) {
    const perArm = report.cells
      .filter((cell) => cell.pathologyId === id)
      .map((cell) => `${cell.armId}=${cell.verdict}`)
      .join(" ");
    lines.push(`  - ${id}: ${perArm}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
