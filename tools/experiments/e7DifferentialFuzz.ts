/**
 * E7 — Cross-language differential fuzz over the parse-canonicalize-digest pipeline.
 *
 * How this differs from E1 and E1-B
 * --------------------------------
 * E1 is a curated census of pathology pairs. E1-B generates well-formed documents and applies
 * declared semantic mutations. Both ask "does this pipeline collapse things it shouldn't?"
 *
 * E7 asks a different question, and it is open-ended:
 *
 *   Feed the SAME raw byte sequence to three independently-implemented JSON pipelines. Do they
 *   agree on whether it is acceptable, and when they all accept, do they agree on the digest?
 *
 * That is the corollary C1 under adversarial search rather than by hand-picked example. A
 * divergence means a receipt verified in one runtime cannot be re-verified in another, which is
 * the whole premise of a receipt as portable evidence.
 *
 * The three arms are genuinely separate implementations, not three wrappers over one parser:
 *
 *   v8      Node's JSON.parse                          (C++, V8)
 *   cpython CPython's json module                       (C, with arbitrary-precision integers)
 *   jq      jq's own parser and number formatter        (C, independent of both)
 *
 * jq matters because it is a third number pipeline. Two arms can agree by coincidence of shared
 * design; three disagreeing pairwise is much harder to dismiss.
 *
 * Why the input generator emits MALFORMED text on purpose
 * -----------------------------------------------------
 * E1-B only ever produces valid JSON, so it cannot find disagreements about what *counts* as
 * JSON. Real divergences live exactly there: trailing commas, leading zeros, bare NaN, control
 * characters, lone surrogates, duplicate keys, deep nesting. Roughly half of E7's corpus is
 * expected to be rejected by everything, and the interesting cases are where the arms split.
 *
 * Provenance: SAMPLED from a declared, seeded generator, so a Wilson interval on the divergence
 * rate is legitimate. As in E1-B, that interval describes THIS generator and not production
 * traffic.
 *
 * NON-CLAIM: E7 measures pipeline agreement over synthetic inputs from a declared generator. A
 * divergence is a portability defect under the arms tested; agreement is not correctness, since
 * three implementations can share a misreading. It is not evidence of cryptographic strength,
 * model safety, semantic truth, compliance, or AWS behavior.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { canonicalize } from "../../packages/receipt-schema/src/hashCanonicalization";
import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { wilsonInterval } from "../../packages/research-frontier/src/oracle/mEstimator";

export const E7_REPORT_SCHEMA_VERSION = "ghost.e7_differential_fuzz.v1";

const DEFAULT_TRIALS = 1500;
const DEFAULT_SEED = 0xe7_f0_02;

/* ------------------------------------------------------------------ PRNG */

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/* --------------------------------------------------- declared generator */

/**
 * Token fragments the generator assembles into candidate JSON text. Deliberately includes
 * fragments that are NOT valid JSON, because disagreement about validity is the point.
 */
const SCALAR_FRAGMENTS = [
  "null",
  "true",
  "false",
  "0",
  "-0",
  "1",
  "-1",
  "1e2",
  "1E2",
  "1e+2",
  "1e-2",
  "1.0",
  "1.50",
  "0.1",
  "0.1000000000000000055511151231257827",
  "9007199254740992",
  "9007199254740993",
  "123456789012345678901234567890",
  "1e400",
  "-1e400",
  "01", // invalid: leading zero
  ".5", // invalid: no integer part
  "5.", // invalid: trailing point
  "+1", // invalid: leading plus
  "NaN", // invalid in JSON
  "Infinity", // invalid in JSON
  "0x10", // invalid
  '""',
  '"a"',
  '"café"',
  '"cafe\\u0301"',
  '"\\u0041"',
  '"\\ud83d\\ude00"',
  '"\\ud800"', // lone surrogate
  '"a\\/b"',
  '"tab\\there"',
  "'single'" // invalid: single quotes
] as const;

const KEY_FRAGMENTS = ['"a"', '"b"', '""', '"é"', '"__proto__"', '"a "', "a" /* invalid: bare key */] as const;

export interface GeneratorConfig {
  maxDepth: number;
  maxMembers: number;
  malformedBias: number;
}

export const DECLARED_GENERATOR: GeneratorConfig = {
  maxDepth: 3,
  maxMembers: 4,
  /** Probability of injecting a structural malformation at each composite node. */
  malformedBias: 0.25
};

function generateValue(rng: () => number, depth: number, config: GeneratorConfig): string {
  if (depth >= config.maxDepth || rng() < 0.45) {
    return pick(rng, SCALAR_FRAGMENTS);
  }

  const isObject = rng() < 0.55;
  const count = randomInt(rng, 0, config.maxMembers);
  const parts: string[] = [];

  for (let index = 0; index < count; index += 1) {
    parts.push(isObject ? `${pick(rng, KEY_FRAGMENTS)}:${generateValue(rng, depth + 1, config)}` : generateValue(rng, depth + 1, config));
  }

  let body = parts.join(",");

  // Structural malformations, applied on purpose.
  if (rng() < config.malformedBias && parts.length > 0) {
    const malformation = randomInt(rng, 0, 3);
    if (malformation === 0) {
      body = `${body},`; // trailing comma
    } else if (malformation === 1) {
      body = `${body},,`; // empty element
    } else if (malformation === 2) {
      body = body.replace(",", " "); // missing separator
    } else {
      body = ` ${body} `; // benign whitespace, must NOT cause divergence
    }
  }

  return isObject ? `{${body}}` : `[${body}]`;
}

/* --------------------------------------------------------------- the arms */

export type ArmOutcome = { status: "digest"; digest: string } | { status: "rejected" };

export interface FuzzArm {
  id: string;
  language: string;
  available: boolean;
  detail: string;
  run: (rawText: string) => ArmOutcome;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** V8 arm: Node JSON.parse + the Ghost-Ark canonicalizer. */
function v8Arm(rawText: string): ArmOutcome {
  try {
    return { status: "digest", digest: sha256Hex(canonicalize(JSON.parse(rawText) as unknown)) };
  } catch {
    return { status: "rejected" };
  }
}

/**
 * Batched subprocess arms. One process per input would make a 1500-trial run take minutes, so
 * each arm receives the whole corpus on stdin (one input per line, base64-encoded so embedded
 * newlines and control characters survive transport) and returns one result per line.
 *
 * Base64 on the wire is deliberate: passing raw text would make the transport itself a source
 * of divergence, and E7 would end up measuring its own harness.
 */
const PYTHON_BATCH = [
  "import sys,json,hashlib,base64",
  "for line in sys.stdin:",
  "    line=line.strip()",
  "    if not line:",
  "        continue",
  "    raw=base64.b64decode(line).decode('utf-8','surrogatepass')",
  "    try:",
  "        v=json.loads(raw)",
  "        c=json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)",
  "        b=c.encode('utf-8')",
  "        print('d:'+hashlib.sha256(b).hexdigest())",
  "    except Exception:",
  "        print('r')"
].join("\n");

/**
 * jq arm. `-S` sorts object keys, `-c` emits compact output, so the canonical form is
 * jq's own. Its number formatter and parser are independent of both V8 and CPython.
 */
const JQ_BATCH_PROGRAM = "-S";

function runBatchedArm(command: string, args: string[], inputs: string[], parseLine: (line: string) => ArmOutcome): ArmOutcome[] {
  const encoded = inputs.map((input) => Buffer.from(input, "utf8").toString("base64")).join("\n");
  const stdout = execFileSync(command, args, { input: `${encoded}\n`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length !== inputs.length) {
    throw new Error(`ghost_ark.e7: ${command} returned ${lines.length} results for ${inputs.length} inputs; refusing to align them by guesswork.`);
  }
  return lines.map(parseLine);
}

function probe(command: string, args: string[]): { available: boolean; detail: string } {
  try {
    return { available: true, detail: execFileSync(command, args, { encoding: "utf8", timeout: 10_000 }).trim().split("\n")[0] ?? command };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export interface DivergenceRow {
  input: string;
  outcomes: Record<string, "rejected" | string>;
  /** "validity" when arms disagree on acceptance; "digest" when all accept but digests differ. */
  kind: "validity" | "digest";
}

export interface E7Report {
  schema_version: typeof E7_REPORT_SCHEMA_VERSION;
  sample_provenance: "sampled";
  seed: number;
  trials: number;
  generator: GeneratorConfig;
  arms: { id: string; language: string; available: boolean; detail: string }[];
  /** Inputs accepted by every available arm. */
  unanimouslyAccepted: number;
  /** Inputs rejected by every available arm. */
  unanimouslyRejected: number;
  validityDivergences: number;
  /**
   * Count of PAIRS of unanimously-accepted inputs whose identity relation differs between arms.
   * Its denominator is pair count, not trial count.
   */
  structureDivergentPairs: number;
  comparedPairs: number;
  /** Validity divergences over INPUTS. */
  validityDivergenceRate: ProportionReport;
  /**
   * Structure divergences over PAIRS. Reported separately from validityDivergenceRate on
   * purpose: an earlier version of this experiment summed the two into one rate over `trials`,
   * which silently combined a per-input count with a per-pair count. Two counts with different
   * denominators are not addable, and the combined figure was meaningless.
   */
  structureDivergenceRate: ProportionReport;
  /** A bounded, DEDUPLICATED sample of divergent inputs, for diagnosis. */
  examples: DivergenceRow[];
  /**
   * The headline of this experiment. Each entry is a distinct structural divergence class and
   * names which arm is the outlier. The RATE alone would overstate the diversity of the problem:
   * a random generator rediscovers the same handful of classes hundreds of times, so 199
   * divergent pairs is not 199 phenomena. Reporting the classes is what makes the rate readable.
   */
  structureClasses: { pair: string; outlier: string; behavior: string }[];
  non_claim: string;
}

const NON_CLAIM =
  "E7 measures pipeline agreement over synthetic inputs from a declared, seeded generator. A divergence is a " +
  "portability defect under the arms tested; agreement is not correctness, since three implementations can share a " +
  "misreading. Its interval describes this generator, not production traffic. It is not evidence of cryptographic " +
  "strength, model safety, semantic truth, compliance, or AWS behavior.";

export interface E7Options {
  seed?: number;
  trials?: number;
}

export function runE7Fuzz(options: E7Options = {}): E7Report {
  const seed = options.seed ?? DEFAULT_SEED;
  const trials = options.trials ?? DEFAULT_TRIALS;
  const rng = makeRng(seed);

  const inputs: string[] = [];
  for (let index = 0; index < trials; index += 1) {
    inputs.push(generateValue(rng, 0, DECLARED_GENERATOR));
  }

  const pythonProbe = probe("python3", ["--version"]);
  const jqProbe = probe("jq", ["--version"]);

  const outcomesByArm = new Map<string, ArmOutcome[]>();
  outcomesByArm.set("v8", inputs.map((input) => v8Arm(input)));

  if (pythonProbe.available) {
    outcomesByArm.set(
      "cpython",
      runBatchedArm("python3", ["-c", PYTHON_BATCH], inputs, (line) => (line.startsWith("d:") ? { status: "digest", digest: line.slice(2) } : { status: "rejected" }))
    );
  }

  if (jqProbe.available) {
    // jq exits nonzero on the first parse error, so each input is fed through a wrapper that
    // reports per-line success. Using `jq -e` per input would be correct but slow; instead a
    // small shell loop keeps one process per input only for jq, which is the cheapest arm.
    const jqOutcomes: ArmOutcome[] = inputs.map((input) => {
      try {
        const compact = execFileSync("jq", [JQ_BATCH_PROGRAM, "-c", "."], { input, encoding: "utf8", timeout: 20_000, stdio: ["pipe", "pipe", "ignore"] }).trim();
        return compact.length === 0 ? { status: "rejected" } : { status: "digest", digest: sha256Hex(compact) };
      } catch {
        return { status: "rejected" };
      }
    });
    outcomesByArm.set("jq", jqOutcomes);
  }

  const armIds = [...outcomesByArm.keys()];

  let unanimouslyAccepted = 0;
  let unanimouslyRejected = 0;
  let validityDivergences = 0;
  let digestDivergences = 0;
  const examples: DivergenceRow[] = [];
  /**
   * Deduplicates reported examples by divergence SHAPE. A random generator rediscovers the same
   * pair many times, and eight identical lines teach a reader less than one line per distinct
   * class. Only the EXAMPLES are deduplicated; the counts below include every occurrence.
   */
  const seenExampleKeys = new Set<string>();

  for (let index = 0; index < inputs.length; index += 1) {
    const perArm = armIds.map((armId) => ({ armId, outcome: (outcomesByArm.get(armId) as ArmOutcome[])[index] as ArmOutcome }));
    const accepted = perArm.filter((entry) => entry.outcome.status === "digest");

    if (accepted.length === 0) {
      unanimouslyRejected += 1;
      continue;
    }

    if (accepted.length !== perArm.length) {
      validityDivergences += 1;
      // Separate caps per class. A single shared cap filled with validity divergences and hid
      // the structure class entirely, which is the more interesting of the two.
      const validityKey = inputs[index] as string;
      if (!seenExampleKeys.has(validityKey) && examples.filter((entry) => entry.kind === "validity").length < 12) {
        seenExampleKeys.add(validityKey);
        examples.push({
          input: inputs[index] as string,
          outcomes: Object.fromEntries(perArm.map((entry) => [entry.armId, entry.outcome.status === "digest" ? entry.outcome.digest.slice(0, 12) : "rejected"])),
          kind: "validity"
        });
      }
      continue;
    }

    // Every arm accepted. Note that arms use DIFFERENT canonical forms (Ghost-Ark's, CPython's
    // json.dumps, jq's -S -c), so a digest mismatch here is expected and is NOT itself a defect.
    // What matters is the EQUIVALENCE STRUCTURE: two inputs that one arm identifies must be
    // identified by the others too. That relation is measured below.
    unanimouslyAccepted += 1;
    void digestDivergences;
  }

  // Equivalence-structure comparison. For each arm, partition the unanimously-accepted inputs
  // by digest, then check that every pair identified by one arm is identified by all of them.
  // This is the portable question: cross-runtime re-verification depends on the arms agreeing
  // about WHICH inputs are the same, not about what the canonical bytes look like.
  const acceptedIndices: number[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    if (armIds.every((armId) => ((outcomesByArm.get(armId) as ArmOutcome[])[index] as ArmOutcome).status === "digest")) {
      acceptedIndices.push(index);
    }
  }

  let structureDivergences = 0;
  for (let left = 0; left < acceptedIndices.length; left += 1) {
    for (let right = left + 1; right < acceptedIndices.length; right += 1) {
      const a = acceptedIndices[left] as number;
      const b = acceptedIndices[right] as number;
      const sameByArm = armIds.map((armId) => {
        const arm = outcomesByArm.get(armId) as ArmOutcome[];
        return (arm[a] as { digest: string }).digest === (arm[b] as { digest: string }).digest;
      });
      if (new Set(sameByArm).size > 1) {
        structureDivergences += 1;
        const exampleKey = [inputs[a] as string, inputs[b] as string].sort().join(" || ");
        if (!seenExampleKeys.has(exampleKey) && examples.filter((entry) => entry.kind === "digest").length < 12) {
          seenExampleKeys.add(exampleKey);
          examples.push({
            input: [inputs[a] as string, inputs[b] as string].sort().join("   ||   "),
            outcomes: Object.fromEntries(armIds.map((armId, position) => [armId, sameByArm[position] ? "identifies-both-as-same" : "distinguishes"])),
            kind: "digest"
          });
        }
      }
    }
  }
  digestDivergences = structureDivergences;

  const comparedPairs = (acceptedIndices.length * (acceptedIndices.length - 1)) / 2;

  // Name the outlier arm per class: the one whose identity judgement differs from the other two.
  const structureClasses = examples
    .filter((example) => example.kind === "digest")
    .map((example) => {
      const entries = Object.entries(example.outcomes);
      const counts = new Map<string, number>();
      for (const [, behavior] of entries) {
        counts.set(behavior, (counts.get(behavior) ?? 0) + 1);
      }
      const minority = [...counts.entries()].sort((left, right) => left[1] - right[1])[0];
      const outlierEntry = entries.find(([, behavior]) => behavior === minority?.[0]);
      return {
        pair: example.input,
        outlier: outlierEntry?.[0] ?? "indeterminate",
        behavior: outlierEntry?.[1] ?? "indeterminate"
      };
    });

  return {
    schema_version: E7_REPORT_SCHEMA_VERSION,
    sample_provenance: "sampled",
    seed,
    trials,
    generator: DECLARED_GENERATOR,
    arms: [
      { id: "v8", language: "Node JSON.parse + Ghost-Ark canonicalize", available: true, detail: process.version },
      { id: "cpython", language: "CPython json", available: pythonProbe.available, detail: pythonProbe.detail },
      { id: "jq", language: "jq -S -c", available: jqProbe.available, detail: jqProbe.detail }
    ],
    unanimouslyAccepted,
    unanimouslyRejected,
    validityDivergences,
    structureDivergentPairs: digestDivergences,
    comparedPairs,
    validityDivergenceRate: reportProportion(validityDivergences, Math.max(1, trials), "sampled", wilsonInterval),
    structureDivergenceRate: reportProportion(digestDivergences, Math.max(1, comparedPairs), "sampled", wilsonInterval),
    examples,
    structureClasses,
    non_claim: NON_CLAIM
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function main(): void {
  const seedFlag = process.argv.indexOf("--seed");
  const trialsFlag = process.argv.indexOf("--trials");
  const report = runE7Fuzz({
    seed: seedFlag !== -1 ? Number(process.argv[seedFlag + 1]) : undefined,
    trials: trialsFlag !== -1 ? Number(process.argv[trialsFlag + 1]) : undefined
  });

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E7 cross-language differential fuzz (${report.schema_version})`);
  lines.push(`provenance: ${report.sample_provenance} — seed ${report.seed}, ${report.trials} inputs, deterministic`);
  lines.push("");
  lines.push("arms:");
  for (const arm of report.arms) {
    lines.push(`  ${arm.available ? "OK  " : "SKIP"} ${arm.id.padEnd(9)} ${arm.language.padEnd(42)} ${arm.detail}`);
  }
  lines.push("");
  lines.push(`unanimously accepted: ${report.unanimouslyAccepted}`);
  lines.push(`unanimously rejected: ${report.unanimouslyRejected}   (roughly half the corpus is malformed on purpose)`);
  lines.push("");
  lines.push("Two divergence classes, reported over their OWN denominators. They are not addable:");
  lines.push(
    `  VALIDITY   ${report.validityDivergences}/${report.trials} inputs  = ${percent(report.validityDivergenceRate.observed)}${report.validityDivergenceRate.interval ? ` 95% Wilson [${percent(report.validityDivergenceRate.interval.low)}, ${percent(report.validityDivergenceRate.interval.high)}]` : ""}`
  );
  lines.push("             arms disagree on whether the input is JSON at all");
  lines.push(
    `  STRUCTURE  ${report.structureDivergentPairs}/${report.comparedPairs} pairs  = ${percent(report.structureDivergenceRate.observed)}${report.structureDivergenceRate.interval ? ` 95% Wilson [${percent(report.structureDivergenceRate.interval.low)}, ${percent(report.structureDivergenceRate.interval.high)}]` : ""}`
  );
  lines.push("             over UNANIMOUSLY ACCEPTED inputs only: arms disagree about which are the SAME");
  lines.push("");
  lines.push(`DISTINCT structural divergence classes: ${report.structureClasses.length}`);
  lines.push("  (the rate above counts every rediscovery; these are the actual phenomena)");
  for (const structureClass of report.structureClasses) {
    lines.push(`  ${structureClass.pair}`);
    lines.push(`      outlier: ${structureClass.outlier} (${structureClass.behavior})`);
  }
  lines.push("");
  lines.push("example divergences:");
  for (const example of report.examples) {
    const detail = Object.entries(example.outcomes)
      .map(([armId, value]) => `${armId}=${value}`)
      .join(" ");
    lines.push(`  [${example.kind}] ${example.input.slice(0, 78)}`);
    lines.push(`            ${detail}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main();
}
