/**
 * Kernel probe — point the pathology alphabet at ANY canonicalizer.
 *
 * WHAT THIS IS FOR
 *
 * E1 and E11 answer a question about specific implementations. This is the same
 * measurement made general: give it a command that reads JSON on stdin and
 * writes a canonical form on stdout, and it reports which real distinctions that
 * canonicalizer destroys.
 *
 *     npx ts-node tools/experiments/kernelProbe.ts --command "jq -S -c ."
 *     npx ts-node tools/experiments/kernelProbe.ts --command "./my-canonicalizer" --json
 *
 * Nothing about it is Ghost-Ark specific. It needs no receipt, no AWS, no trust
 * in this project, and no agreement with this project's conclusions. It is the
 * piece of this work most useful to somebody else, which is why it is a CLI
 * rather than another experiment file.
 *
 * WHY A CANONICALIZER MIGHT WANT THIS
 *
 * Any system that assigns identity by canonicalization inherits a kernel: the
 * set of input pairs it maps to one identity. Content-addressed stores, SBOM
 * digests, transparency-log entries, in-toto and Sigstore attestations, model
 * registries — all of them answer "is this the same artifact?" with a digest
 * over a canonical form. A kernel member is a pair of *different* documents that
 * such a system cannot tell apart. Whether that matters depends entirely on who
 * consumes the identity, which is why every pathology here ships with a declared
 * consumer rationale rather than a verdict handed down.
 *
 * THE CONTRACT
 *
 *   stdin    one raw JSON document, exactly as transmitted
 *   stdout   the canonical form (bytes are digested as-is, trailing newline
 *            stripped); the probe computes SHA-256 itself so the command need
 *            not agree with it about hashing
 *   exit 0   accepted
 *   exit !=0 rejected — a refusal is a legitimate, often correct answer, and is
 *            scored separately from a collapse
 *
 * `--emit-alphabet` writes the corpus as JSON so it can be run in any language
 * without this repository or its toolchain.
 *
 * NON-CLAIM: this probe measures identifiability structure over ONE hand-curated
 * adversarial alphabet against ONE declared consumer set. It is not a random
 * sample of JSON, not exhaustive, not a security review, and not a statement
 * that any canonicalizer is defective — a collapse means only that its canonical
 * form identifies two documents the declared consumer would distinguish. Absence
 * of a class here is not evidence of its absence in practice. A clean report is
 * not evidence of safety, correctness, or compliance.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { PATHOLOGY_ALPHABET, assertAlphabetWellFormed, type PathologyClass } from "./kernelAlphabet";
import { classify, type CensusVerdict } from "./e1KernelCensus";
import type { ArmOutcome } from "./canonicalizerArms";

export const KERNEL_PROBE_SCHEMA_VERSION = "ghost.kernel_probe.v1";

export interface ProbeCell {
  pathologyId: string;
  description: string;
  intent: PathologyClass["intent"];
  consumerRationale: string;
  observed: "collapsed" | "distinct" | "rejected-both" | "rejected-one";
  verdict: CensusVerdict;
  digestA: string | null;
  digestB: string | null;
}

export interface ProbeReport {
  schema_version: typeof KERNEL_PROBE_SCHEMA_VERSION;
  target: string;
  sample_provenance: "census";
  alphabet_size: number;
  counts: Record<CensusVerdict, number>;
  /** The headline: pairs collapsed that the declared consumer distinguishes. */
  unintended_kernel_members: string[];
  /** The dual defect: pairs split that every declared consumer unifies. */
  over_discriminated: string[];
  cells: ProbeCell[];
  non_claim: string;
}

const NON_CLAIM =
  "This probe measures identifiability structure over one hand-curated adversarial alphabet against one declared " +
  "consumer set. It is not a random sample of JSON, not exhaustive, not a security review, and not a statement that " +
  "any canonicalizer is defective: a collapse means only that its canonical form identifies two documents the " +
  "declared consumer would distinguish. Absence of a class here is not evidence of its absence in practice, and a " +
  "clean report is not evidence of safety, correctness, or compliance.";

/**
 * Runs the target once. A non-zero exit is a REJECTION, not an error.
 *
 * This distinction is the one every previous version of this measurement got
 * wrong at least once: a canonicalizer that refuses malformed input is behaving
 * well, and scoring that as a failure — or as agreement — misreports it. What is
 * genuinely an error (the command does not exist, cannot be spawned) throws.
 */
export function runTarget(command: string, args: readonly string[], rawJson: string): ArmOutcome {
  let stdout: string;
  try {
    stdout = execFileSync(command, [...args], {
      input: rawJson,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "ignore"]
    });
  } catch (error) {
    const failure = error as { status?: number | null; code?: string; message?: string };
    if (failure.code === "ENOENT") {
      throw new Error(`kernel-probe: command not found: ${command}`);
    }
    // Any non-zero exit is the target declining the input.
    return { status: "rejected", reason: `exit ${failure.status ?? "signal"}` };
  }

  const canonical = stdout.replace(/\n$/u, "");
  if (canonical.length === 0) {
    return { status: "rejected", reason: "target produced no canonical output" };
  }
  return {
    status: "digest",
    digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
    canonicalForm: canonical
  };
}

export function probeKernel(
  command: string,
  args: readonly string[] = [],
  alphabet: readonly PathologyClass[] = PATHOLOGY_ALPHABET,
  runner: (cmd: string, a: readonly string[], raw: string) => ArmOutcome = runTarget
): ProbeReport {
  assertAlphabetWellFormed(alphabet);

  const cells: ProbeCell[] = [];
  for (const pathology of alphabet) {
    const outcomeA = runner(command, args, pathology.rawA);
    const outcomeB = runner(command, args, pathology.rawB);
    const { observed, verdict } = classify(pathology.intent, outcomeA, outcomeB);
    cells.push({
      pathologyId: pathology.id,
      description: pathology.description,
      intent: pathology.intent,
      consumerRationale: pathology.consumerRationale,
      observed,
      verdict,
      digestA: outcomeA.status === "digest" ? outcomeA.digest : null,
      digestB: outcomeB.status === "digest" ? outcomeB.digest : null
    });
  }

  const counts = {
    sound: 0,
    "unintended-kernel": 0,
    "over-discrimination": 0,
    "fail-closed": 0,
    "sound-by-rejection": 0,
    "rejection-asymmetry": 0
  } as Record<CensusVerdict, number>;
  for (const cell of cells) {
    counts[cell.verdict] += 1;
  }

  return {
    schema_version: KERNEL_PROBE_SCHEMA_VERSION,
    target: [command, ...args].join(" "),
    sample_provenance: "census",
    alphabet_size: alphabet.length,
    counts,
    unintended_kernel_members: cells.filter((c) => c.verdict === "unintended-kernel").map((c) => c.pathologyId),
    over_discriminated: cells.filter((c) => c.verdict === "over-discrimination").map((c) => c.pathologyId),
    cells,
    non_claim: NON_CLAIM
  };
}

const USAGE = `kernel-probe — report which distinctions a canonicalizer destroys

USAGE
  kernel-probe --command "<program> [args...]" [--json] [--fail-on-kernel]
  kernel-probe --emit-alphabet

CONTRACT FOR <program>
  stdin     one raw JSON document
  stdout    its canonical form (SHA-256 is computed here, not by the program)
  exit 0    accepted
  exit !=0  rejected (a legitimate answer, scored separately from a collapse)

OPTIONS
  --command         the canonicalizer to probe (required unless --emit-alphabet)
  --json            emit the full machine-readable report
  --fail-on-kernel  exit 1 if any unintended kernel member is found
  --emit-alphabet   write the pathology corpus as JSON and exit, so it can be
                    run in any language without this repository

EXAMPLES
  kernel-probe --command "jq -S -c ."
  kernel-probe --command "python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin),sort_keys=True,separators=(\\",\\",\\":\\")))'"
  kernel-probe --emit-alphabet > pathologies.json
`;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  if (process.argv.includes("--emit-alphabet")) {
    process.stdout.write(`${JSON.stringify(PATHOLOGY_ALPHABET, null, 2)}\n`);
    return;
  }

  const target = argValue("--command");
  if (!target || process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(USAGE);
    process.exitCode = target ? 0 : 2;
    return;
  }

  // Split on whitespace so `--command "jq -S -c ."` works. Anything needing
  // real shell quoting should be wrapped in a script — deliberately NOT passed
  // through a shell, because this tool is meant to be safe to point at
  // untrusted-ish input without also handing it a shell.
  const parts = target.trim().split(/\s+/u);
  const report = probeKernel(parts[0] as string, parts.slice(1));

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines: string[] = [];
    lines.push(`kernel-probe (${report.schema_version})`);
    lines.push(`target: ${report.target}`);
    lines.push(`alphabet: ${report.alphabet_size} classes | provenance: census (no confidence intervals)`);
    lines.push("");
    lines.push(
      `sound ${report.counts.sound} | UNINTENDED-KERNEL ${report.counts["unintended-kernel"]} | ` +
        `over-discrimination ${report.counts["over-discrimination"]} | fail-closed ${report.counts["fail-closed"]} | ` +
        `sound-by-rejection ${report.counts["sound-by-rejection"]} | rejection-asymmetry ${report.counts["rejection-asymmetry"]}`
    );
    lines.push("");
    lines.push(`UNINTENDED KERNEL MEMBERS (${report.unintended_kernel_members.length}) — pairs a declared consumer distinguishes but this canonicalizer identifies:`);
    for (const cell of report.cells.filter((c) => c.verdict === "unintended-kernel")) {
      lines.push(`  - ${cell.pathologyId}: ${cell.description}`);
      lines.push(`      who cares: ${cell.consumerRationale.split(". ")[0]}.`);
    }
    lines.push("");
    lines.push(`OVER-DISCRIMINATION (${report.over_discriminated.length}) — pairs every declared consumer unifies but this canonicalizer splits:`);
    for (const id of report.over_discriminated) {
      lines.push(`  - ${id}`);
    }
    lines.push("");
    lines.push(`NON-CLAIM: ${report.non_claim}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (process.argv.includes("--fail-on-kernel") && report.unintended_kernel_members.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
