/**
 * E11 — Does the kernel result survive canonicalizers this project did not write?
 *
 * The question
 * ------------
 * E1 measures the provenance kernel across five arms. Four of them are Ghost-Ark
 * code and the fifth is CPython's `json` driven by a Ghost-Ark script. E5 already
 * records the limitation this creates: three verifiers written by one author from
 * one specification can share one misreading, and no amount of internal agreement
 * detects that.
 *
 * So the corollary this repository actually wants to defend —
 *
 *   C2. Unintended kernel members are a property of the parse-canonicalize-digest
 *       PROBLEM, not of Ghost-Ark's implementation of it
 *
 * — cannot be established by arms Ghost-Ark controls. E11 runs the same
 * pre-registered pathology alphabet against canonicalization pipelines written
 * entirely outside this repository, by people who never saw it:
 *
 *   rust-serde-json   serde_json (Rust) + explicit key sort + sha2
 *   ruby-json         Ruby's stdlib JSON + sorted keys + Digest::SHA256
 *   cpython-json      CPython json.dumps(sort_keys=True)
 *   jq-sorted         jq -S -c
 *
 * Each is the canonicalization a competent engineer reaches for in that language:
 * parse, sort object keys, emit compactly, digest the UTF-8 bytes. None of them
 * is Ghost-Ark's canonicalizer, and none was written with this alphabet in view.
 *
 * Why this is the right test of generality
 * ---------------------------------------
 * If the same pathology classes collapse across four independent language
 * ecosystems, the finding is about JSON identity rather than about this project.
 * If they collapse only here, C2 is an artifact and this experiment says so.
 *
 * A NOTE ON WHAT IS BORROWED AND WHAT IS NOT
 * -----------------------------------------
 * The verdict function is imported from E1 rather than reimplemented, so E11
 * cannot accidentally grade on a different curve. The alphabet is imported for
 * the same reason and is pinned by `kernelAlphabet` tests. What differs from E1
 * is only the arms.
 *
 * Provenance: census. Curated, adversarial, exhaustive over the declared
 * alphabet. Exact counts, no confidence intervals.
 *
 * NON-CLAIM: E11 measures identifiability structure of four third-party
 * pipelines over one hand-curated alphabet. It is not a random sample of JSON
 * libraries, not a security review of any of them, not a statement that any
 * library is defective — every arm here behaves exactly as its documentation
 * says — and not evidence about model safety, compliance, or production
 * readiness. A library "collapsing" a pair means only that its canonical form
 * identifies two documents a Ghost-Ark consumer would distinguish.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { PATHOLOGY_ALPHABET, assertAlphabetWellFormed, type PathologyClass } from "./kernelAlphabet";
import { classify, type CensusVerdict } from "./e1KernelCensus";
import type { ArmOutcome } from "./canonicalizerArms";

export const E11_REPORT_SCHEMA_VERSION = "ghost.e11_third_party_kernel.v1";

const REPO_ROOT = resolve(__dirname, "../..");
const RUST_ARM_BIN = resolve(REPO_ROOT, "tools/experiments-json/target/debug/serde-json-arm");

/** Spawn failures that are properties of the machine at this instant. */
const TRANSIENT_SPAWN_CODES = new Set(["ETIMEDOUT", "EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ENOMEM"]);

function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_SPAWN_CODES.has(code);
}

/** Same one-retry discipline as E1's Python arm, for the same reason. */
function runOnce(file: string, args: string[], input: string): string {
  try {
    return execFileSync(file, args, { input, encoding: "utf8", timeout: 30_000 });
  } catch (error) {
    if (!isTransient(error)) {
      throw error;
    }
    return execFileSync(file, args, { input, encoding: "utf8", timeout: 30_000 });
  }
}

export interface ThirdPartyArm {
  id: string;
  language: string;
  description: string;
  /** How this arm decides key order — the one design choice each implementer makes. */
  keyOrdering: string;
  available: boolean;
  detail: string;
  run: (rawJson: string) => ArmOutcome;
}

function probe(command: string, args: string[]): { available: boolean; detail: string } {
  try {
    const out = execFileSync(command, args, { encoding: "utf8", timeout: 10_000 });
    return { available: true, detail: out.trim().split("\n")[0] ?? command };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Parses the one-line JSON protocol every subprocess arm speaks. */
function parseArmLine(stdout: string, armId: string): ArmOutcome {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { status: "rejected", reason: `${armId} produced no output` };
  }
  const parsed = JSON.parse(trimmed) as { status: string; reason?: string; digest?: string; canonicalForm?: string };
  if (parsed.status === "rejected") {
    return { status: "rejected", reason: parsed.reason ?? `${armId} rejected without a reason` };
  }
  return {
    status: "digest",
    digest: parsed.digest as string,
    canonicalForm: parsed.canonicalForm as string
  };
}

/**
 * Ruby arm. Sorts object keys recursively, emits with `JSON.generate`, digests
 * the UTF-8 bytes. `JSON.parse` raises on malformed input, which becomes a
 * rejection rather than a crash.
 */
const RUBY_PROGRAM = [
  "require 'json'",
  "require 'digest'",
  "def sort_keys(v)",
  "  case v",
  "  when Hash then v.keys.sort.each_with_object({}) { |k, h| h[k] = sort_keys(v[k]) }",
  "  when Array then v.map { |e| sort_keys(e) }",
  "  else v",
  "  end",
  "end",
  "raw = STDIN.read",
  "begin",
  "  parsed = JSON.parse(raw)",
  "rescue => e",
  "  puts({status: 'rejected', reason: \"ruby JSON.parse: #{e.message}\"}.to_json); exit 0",
  "end",
  "begin",
  "  canonical = JSON.generate(sort_keys(parsed))",
  "rescue => e",
  "  puts({status: 'rejected', reason: \"ruby JSON.generate: #{e.message}\"}.to_json); exit 0",
  "end",
  "digest = Digest::SHA256.hexdigest(canonical)",
  "puts({status: 'digest', digest: digest, canonicalForm: canonical}.to_json)"
].join("\n");

const PYTHON_PROGRAM = [
  "import json,sys,hashlib",
  "raw=sys.stdin.read()",
  "try:",
  "    v=json.loads(raw)",
  "except Exception as e:",
  "    print(json.dumps({'status':'rejected','reason':'cpython json.loads: '+str(e)}));sys.exit(0)",
  "try:",
  "    c=json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)",
  "    b=c.encode('utf-8')",
  "except Exception as e:",
  "    print(json.dumps({'status':'rejected','reason':'cpython encode: '+str(e)}));sys.exit(0)",
  "print(json.dumps({'status':'digest','digest':hashlib.sha256(b).hexdigest(),'canonicalForm':c}))"
].join("\n");

export function buildThirdPartyArms(): ThirdPartyArm[] {
  const rubyProbe = probe("ruby", ["-v"]);
  const pythonProbe = probe("python3", ["--version"]);
  const jqProbe = probe("jq", ["--version"]);
  const rustAvailable = existsSync(RUST_ARM_BIN);

  return [
    {
      id: "rust-serde-json",
      language: "Rust",
      description: "serde_json parse + explicit recursive key sort + sha2",
      keyOrdering: "explicit sort (serde_json built with preserve_order)",
      available: rustAvailable,
      detail: rustAvailable
        ? "tools/experiments-json/target/debug/serde-json-arm"
        : "not built — run: cargo build --manifest-path tools/experiments-json/Cargo.toml",
      run: (rawJson) => parseArmLine(runOnce(RUST_ARM_BIN, [], rawJson), "rust-serde-json")
    },
    {
      id: "ruby-json",
      language: "Ruby",
      description: "stdlib JSON.parse + recursive key sort + Digest::SHA256",
      keyOrdering: "explicit sort (Hash preserves insertion order)",
      available: rubyProbe.available,
      detail: rubyProbe.detail,
      run: (rawJson) => parseArmLine(runOnce("ruby", ["-e", RUBY_PROGRAM], rawJson), "ruby-json")
    },
    {
      id: "cpython-json",
      language: "CPython",
      description: "json.loads + json.dumps(sort_keys=True, allow_nan=False)",
      keyOrdering: "sort_keys=True",
      available: pythonProbe.available,
      detail: pythonProbe.detail,
      run: (rawJson) => parseArmLine(runOnce("python3", ["-c", PYTHON_PROGRAM], rawJson), "cpython-json")
    },
    {
      id: "jq-sorted",
      language: "jq",
      description: "jq -S -c (sorted keys, compact) + sha256 of the output bytes",
      keyOrdering: "-S",
      available: jqProbe.available,
      detail: jqProbe.detail,
      run: (rawJson) => {
        let out: string;
        try {
          out = runOnce("jq", ["-S", "-c", "."], rawJson);
        } catch (error) {
          return { status: "rejected", reason: `jq: ${error instanceof Error ? error.message : String(error)}` };
        }
        const canonical = out.trim();
        if (canonical.length === 0) {
          return { status: "rejected", reason: "jq produced no output" };
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createHash } = require("node:crypto") as typeof import("node:crypto");
        return {
          status: "digest",
          digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
          canonicalForm: canonical
        };
      }
    }
  ];
}

export interface E11Cell {
  pathologyId: string;
  armId: string;
  intent: PathologyClass["intent"];
  observed: "collapsed" | "distinct" | "rejected-both" | "rejected-one";
  verdict: CensusVerdict;
}

export interface E11ArmSummary {
  armId: string;
  language: string;
  description: string;
  keyOrdering: string;
  detail: string;
  sound: number;
  unintendedKernel: number;
  overDiscrimination: number;
  failClosed: number;
  soundByRejection: number;
  rejectionAsymmetry: number;
  unintendedKernelMembers: string[];
}

export interface E11Report {
  schema_version: typeof E11_REPORT_SCHEMA_VERSION;
  sample_provenance: "census";
  alphabet_size: number;
  arms: E11ArmSummary[];
  cells: E11Cell[];
  /** Collapsed against intent by EVERY third-party arm that produced two digests. */
  universal_third_party_kernel: string[];
  /** Collapsed against intent by at least one third-party arm. */
  any_third_party_kernel: string[];
  /** Pathologies where the third-party arms disagree with each other. */
  divergent_pathologies: string[];
  excluded_arms: { armId: string; reason: string }[];
  degraded: boolean;
  non_claim: string;
}

const NON_CLAIM =
  "E11 measures the identifiability structure of four third-party parse-canonicalize-digest pipelines over one " +
  "hand-curated adversarial alphabet, against Ghost-Ark's declared consumer set. It is not a random sample of JSON " +
  "libraries, not a security review of any of them, and not a claim that any library is defective — each behaves as " +
  "documented. A collapse here means only that a library's canonical form identifies two documents a Ghost-Ark " +
  "consumer would distinguish. It is not evidence about model safety, compliance, or production readiness.";

export interface E11Options {
  /** Permit a run with arms missing. Default false; see E1's identical guard. */
  allowDegradedArms?: boolean;
  /**
   * Test seam: substitute the arm list.
   *
   * Exists so the availability guard can be exercised without shelling out to
   * hide a runtime, and without re-running the full 31x4 census a second time —
   * which is 248 subprocess spawns and made the guard test time out under
   * parallel load. Production callers never pass this.
   */
  arms?: ThirdPartyArm[];
}

export function runE11(
  alphabet: readonly PathologyClass[] = PATHOLOGY_ALPHABET,
  options: E11Options = {}
): E11Report {
  assertAlphabetWellFormed(alphabet);

  const declared = options.arms ?? buildThirdPartyArms();
  const excluded = declared
    .filter((arm) => !arm.available)
    .map((arm) => ({ armId: arm.id, reason: arm.detail }));
  const arms = declared.filter((arm) => arm.available);

  if (excluded.length > 0 && options.allowDegradedArms !== true) {
    throw new Error(
      `ghost_ark.e11: ${excluded.length} of ${declared.length} third-party arms are unavailable ` +
        `(${excluded.map((arm) => arm.armId).join(", ")}). Refusing to emit a census: the whole point of this ` +
        "experiment is independence, and dropping an arm changes which collapses count as universal rather than " +
        "merely widening an interval. Install the missing runtime, or pass { allowDegradedArms: true } for an " +
        `explicitly degraded report. Detail: ${excluded.map((arm) => arm.reason).join(" | ")}`
    );
  }

  const cells: E11Cell[] = [];
  for (const pathology of alphabet) {
    for (const arm of arms) {
      const outcomeA = arm.run(pathology.rawA);
      const outcomeB = arm.run(pathology.rawB);
      const { observed, verdict } = classify(pathology.intent, outcomeA, outcomeB);
      cells.push({ pathologyId: pathology.id, armId: arm.id, intent: pathology.intent, observed, verdict });
    }
  }

  const summaries: E11ArmSummary[] = arms.map((arm) => {
    const armCells = cells.filter((cell) => cell.armId === arm.id);
    const count = (verdict: CensusVerdict) => armCells.filter((cell) => cell.verdict === verdict).length;
    return {
      armId: arm.id,
      language: arm.language,
      description: arm.description,
      keyOrdering: arm.keyOrdering,
      detail: arm.detail,
      sound: count("sound"),
      unintendedKernel: count("unintended-kernel"),
      overDiscrimination: count("over-discrimination"),
      failClosed: count("fail-closed"),
      soundByRejection: count("sound-by-rejection"),
      rejectionAsymmetry: count("rejection-asymmetry"),
      unintendedKernelMembers: armCells
        .filter((cell) => cell.verdict === "unintended-kernel")
        .map((cell) => cell.pathologyId)
    };
  });

  // Same MIN_DECIDING_ARMS discipline as E1: "every deciding arm agrees" over a
  // single arm is a statement about one implementation, not about the problem.
  const MIN_DECIDING_ARMS = 2;
  const universal: string[] = [];
  const anyKernel: string[] = [];
  const divergent: string[] = [];

  for (const pathology of alphabet) {
    const pathologyCells = cells.filter((cell) => cell.pathologyId === pathology.id);
    const decided = pathologyCells.filter((cell) => cell.observed === "collapsed" || cell.observed === "distinct");

    if (decided.length >= MIN_DECIDING_ARMS && decided.every((cell) => cell.verdict === "unintended-kernel")) {
      universal.push(pathology.id);
    }
    if (pathologyCells.some((cell) => cell.verdict === "unintended-kernel")) {
      anyKernel.push(pathology.id);
    }
    if (new Set(pathologyCells.map((cell) => cell.verdict)).size > 1) {
      divergent.push(pathology.id);
    }
  }

  return {
    schema_version: E11_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    alphabet_size: alphabet.length,
    arms: summaries,
    cells,
    universal_third_party_kernel: universal,
    any_third_party_kernel: anyKernel,
    divergent_pathologies: divergent,
    excluded_arms: excluded,
    degraded: excluded.length > 0,
    non_claim: NON_CLAIM
  };
}

/** CLI: `npm run experiment:e11 [-- --json] [-- --allow-degraded]` */
function main(): void {
  const report = runE11(PATHOLOGY_ALPHABET, { allowDegradedArms: process.argv.includes("--allow-degraded") });

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E11 third-party kernel census (${report.schema_version})`);
  lines.push(
    `alphabet: ${report.alphabet_size} pathology classes | provenance: ${report.sample_provenance} (no confidence intervals)`
  );
  if (report.degraded) {
    lines.push("");
    lines.push("*** DEGRADED — NOT COMPARABLE TO A FULL-ARM RUN ***");
    for (const arm of report.excluded_arms) {
      lines.push(`  excluded: ${arm.armId} — ${arm.reason}`);
    }
  }
  lines.push("");
  lines.push("arm                language   sound  UNINTENDED-KERNEL  over-discrim  fail-closed  sound-by-rej  rej-asym");
  for (const arm of report.arms) {
    lines.push(
      `${arm.armId.padEnd(18)} ${arm.language.padEnd(10)} ${String(arm.sound).padEnd(6)} ` +
        `${String(arm.unintendedKernel).padEnd(18)} ${String(arm.overDiscrimination).padEnd(13)} ` +
        `${String(arm.failClosed).padEnd(12)} ${String(arm.soundByRejection).padEnd(13)} ${arm.rejectionAsymmetry}`
    );
  }
  lines.push("");
  lines.push(
    `pathologies collapsed against intent by EVERY deciding third-party arm: ${report.universal_third_party_kernel.length}`
  );
  for (const id of report.universal_third_party_kernel) {
    lines.push(`  - ${id}`);
  }
  lines.push("");
  lines.push(`pathologies collapsed by AT LEAST ONE third-party arm: ${report.any_third_party_kernel.length}`);
  lines.push("");
  lines.push(`third-party arms disagreeing with each other: ${report.divergent_pathologies.length}`);
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
  main();
}
