/**
 * E1-B — Randomized kernel probe. The only experiment in this repository that earns a
 * confidence interval.
 *
 * Why it exists
 * -------------
 * E1's census is hand-curated. That is its strength (each pair is adversarially chosen and
 * its consumer intent is pre-registered) and its weakness: it establishes that unintended
 * kernel members EXIST and are PRESENT, never how OFTEN they arise. That gap is falsifier F2
 * in docs/research/00_THESIS.md, and no amount of adding curated classes closes it, because
 * a curated corpus has no sampling distribution to generalize from.
 *
 * E1-B closes it the only way available: draw documents at random from a DECLARED
 * distribution, apply a mutation operator drawn at random from a DECLARED set, and measure
 * the collapse rate. Because the draws are genuinely random from a stated generator, a
 * Wilson interval here describes real sampling variability and is legitimate.
 *
 * What the interval does and does not describe
 * -------------------------------------------
 * It describes variability under THIS generator. It does NOT describe real-world receipt
 * traffic, because the generator is a model of adversarial input, not a sample of production
 * data. Substituting one for the other would be exactly the inferential overreach the census
 * rules exist to prevent. E1-B narrows F2 from "we have no idea how often" to "under a
 * declared adversarial generator, at this rate, with this interval". Real-traffic frequency
 * remains an open gap.
 *
 * Determinism
 * -----------
 * The generator is seeded and the PRNG is implemented here, so a run is exactly reproducible
 * from its seed. `Math.random()` is deliberately not used: a result that cannot be replayed
 * is not evidence.
 *
 * NON-CLAIM: E1-B measures collapse rates of a parse-canonicalize-digest pipeline under a
 * declared synthetic generator. It is not a measurement of production traffic, not a
 * completeness result over JSON, and not evidence of model safety, semantic truth,
 * compliance, or cryptographic strength.
 */

import { createHash } from "node:crypto";
import { canonicalize } from "../../packages/receipt-schema/src/hashCanonicalization";
import { parseStrictJson } from "../../packages/receipt-schema/src/strictJsonAdmission";
import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { wilsonInterval } from "../../packages/research-frontier/src/oracle/mEstimator";

export const E1B_REPORT_SCHEMA_VERSION = "ghost.e1b_randomized_kernel.v1";

/** Trials per operator. Above MIN_N_FOR_PROPORTION_INTERVAL (30) so intervals are defensible. */
const DEFAULT_TRIALS_PER_OPERATOR = 400;
const DEFAULT_SEED = 0x5eed_1b;

/* ------------------------------------------------------------------ PRNG */

/** mulberry32: small, fast, adequate for input generation and exactly reproducible. */
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

function randomInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

/* ------------------------------------------------- declared generator */

const KEY_ALPHABET = ["id", "amount", "rate", "name", "qty", "note", "flag", "ts", "é", "k2", ""] as const;

/**
 * The declared document distribution. Fixing it in code (rather than tuning it until a
 * result appears) is what makes the sampling claim meaningful.
 */
export interface GeneratorConfig {
  maxDepth: number;
  maxKeysPerObject: number;
  maxArrayLength: number;
}

export const DECLARED_GENERATOR: GeneratorConfig = {
  maxDepth: 4,
  maxKeysPerObject: 5,
  maxArrayLength: 4
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function randomScalar(rng: () => number): JsonValue {
  const kind = randomInt(rng, 0, 5);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return rng() < 0.5;
    case 2:
      return randomInt(rng, -1000, 1000);
    case 3:
      return Math.round(rng() * 100000) / 100;
    case 4:
      return pick(rng, ["", "a", "café", "paypal.com", "0", "100", "null"]);
    default:
      return randomInt(rng, 0, 1) === 0 ? 0 : 1;
  }
}

function randomValue(rng: () => number, depth: number, config: GeneratorConfig): JsonValue {
  if (depth >= config.maxDepth || rng() < 0.45) {
    return randomScalar(rng);
  }

  if (rng() < 0.5) {
    const length = randomInt(rng, 0, config.maxArrayLength);
    const array: JsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      array.push(randomValue(rng, depth + 1, config));
    }
    return array;
  }

  const keyCount = randomInt(rng, 1, config.maxKeysPerObject);
  const object: { [key: string]: JsonValue } = {};
  for (let index = 0; index < keyCount; index += 1) {
    object[pick(rng, KEY_ALPHABET)] = randomValue(rng, depth + 1, config);
  }
  return object;
}

/* ------------------------------------------------ mutation operators */

/**
 * `preserving` operators must produce a document every declared consumer treats as the same
 * fact, so a COLLAPSE is correct and a split is over-discrimination.
 * `changing` operators alter content a consumer reads, so a collapse is an UNINTENDED KERNEL
 * MEMBER and is the headline quantity.
 *
 * An operator returns null when it cannot apply to the drawn document (for example, key
 * reordering needs an object with at least two keys). Non-applicable draws are counted and
 * reported, never silently retried into the denominator.
 */
export type OperatorClass = "preserving" | "changing";

export interface MutationOperator {
  id: string;
  operatorClass: OperatorClass;
  rationale: string;
  /** Return mutated RAW TEXT, or null if inapplicable to this document. */
  apply: (rawText: string, value: JsonValue, rng: () => number) => string | null;
  /**
   * Some collapses cannot be expressed as "original vs mutated" because the original is not
   * one of the two colliding inputs. Adjacent integers above 2^53 are the case: replacing a
   * small integer with 2^53+1 yields two genuinely different values, so no collapse occurs and
   * the operator silently measures the wrong thing. Such operators construct BOTH sides.
   */
  applyPair?: (rawText: string, value: JsonValue, rng: () => number) => [string, string] | null;
}

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Serialize with a chosen key order, so reordering is expressible in text. */
function stringifyWithOrder(value: JsonValue, orderChooser: (keys: string[]) => string[]): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyWithOrder(item, orderChooser)).join(",")}]`;
  }
  const keys = orderChooser(Object.keys(value));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyWithOrder(value[key] as JsonValue, orderChooser)}`).join(",")}}`;
}

export const MUTATION_OPERATORS: readonly MutationOperator[] = [
  {
    id: "reorder-object-keys",
    operatorClass: "preserving",
    rationale: "Objects are unordered by RFC 8259, so a reordered document is the same fact.",
    apply: (rawText, value, rng) => {
      const original = isPlainObject(value) ? Object.keys(value) : [];
      if (original.length < 2) {
        return null;
      }

      // Reverse then rotate. Reversal makes the order genuinely change for >= 2
      // keys, so this operator cannot silently degenerate into a no-op -- a no-op would
      // produce identical text and be scored as a "collapse", inflating the
      // correct-behavior rate for free.
      const rotation = randomInt(rng, 0, original.length - 1);
      const reversed = [...original].reverse();
      const rotated = [...reversed.slice(rotation), ...reversed.slice(0, rotation)];

      const mutated = stringifyWithOrder(value, (keys) =>
        keys.length === original.length && keys.every((key, index) => key === original[index]) ? rotated : keys
      );

      return mutated === rawText ? null : mutated;
    }
  },
  {
    id: "insert-insignificant-whitespace",
    operatorClass: "preserving",
    rationale: "Whitespace outside strings carries no JSON meaning.",
    apply: (rawText) => {
      const injected = rawText.replace(/([{[,:])/gu, "$1 ");
      return injected === rawText ? null : injected;
    }
  },
  {
    id: "escape-ascii-letter",
    operatorClass: "preserving",
    rationale: "A \\u escape and the literal character decode to the identical string.",
    apply: (rawText) => {
      const match = /"([a-z])"/u.exec(rawText);
      if (!match) {
        return null;
      }
      const codeUnit = (match[1] as string).charCodeAt(0).toString(16).padStart(4, "0");
      return rawText.replace(match[0], `"\\u${codeUnit}"`);
    }
  },
  {
    id: "duplicate-an-object-key",
    operatorClass: "changing",
    rationale:
      "A document asserting a field twice is a different submission from one asserting it once; JSON.parse resolves last-wins.",
    apply: (rawText, value) => {
      if (!isPlainObject(value) || Object.keys(value).length === 0) {
        return null;
      }
      const key = Object.keys(value)[0] as string;
      const encodedKey = JSON.stringify(key);
      const position = rawText.indexOf(encodedKey);
      if (position === -1) {
        return null;
      }
      // Insert a contradictory earlier assertion of the same key.
      return `{${encodedKey}:0,${rawText.slice(1)}`;
    }
  },
  {
    id: "promote-integer-past-safe-range",
    operatorClass: "changing",
    rationale: "Distinct integers above 2^53 share a double, so the receipt cannot evidence which was submitted.",
    apply: (rawText) => {
      const match = /:(-?\d{1,6})(?=[,}\]])/u.exec(rawText);
      if (!match) {
        return null;
      }
      return rawText.replace(match[0], ":9007199254740993");
    }
  },
  {
    id: "add-excess-precision-digits",
    operatorClass: "changing",
    rationale: "A literal spelling out more precision than a double holds asserts precision the receipt cannot carry.",
    apply: (rawText) => {
      const match = /:(-?\d+)\.(\d+)(?=[,}\]])/u.exec(rawText);
      if (!match) {
        return null;
      }
      return rawText.replace(match[0], `:${match[1]}.${match[2]}00000000000000000000001`);
    }
  },
  {
    id: "swap-scalar-type",
    operatorClass: "changing",
    rationale: "Type is semantic; a string and a number with the same digits are different facts to any typed consumer.",
    apply: (rawText) => {
      const match = /:(-?\d+)(?=[,}\]])/u.exec(rawText);
      if (!match) {
        return null;
      }
      return rawText.replace(match[0], `:"${match[1]}"`);
    }
  },
  {
    id: "adjacent-unsafe-integers",
    operatorClass: "changing",
    rationale:
      "Two integers ONE APART above 2^53 share an IEEE-754 double. Both sides are constructed, because neither " +
      "colliding value is the originally drawn document -- an operator that merely substituted one large integer " +
      "would compare two different values and measure nothing.",
    apply: () => null,
    applyPair: (rawText) => {
      const match = /:(-?\d+)(?=[,}\]])/u.exec(rawText);
      if (!match) {
        return null;
      }
      return [rawText.replace(match[0], ":9007199254740992"), rawText.replace(match[0], ":9007199254740993")];
    }
  },
  {
    id: "adjacent-decimal-literals",
    operatorClass: "changing",
    rationale:
      "Two distinct decimal literals that round to the same double. Both sides are constructed for the same reason as " +
      "adjacent-unsafe-integers.",
    apply: () => null,
    applyPair: (rawText) => {
      const match = /:(-?\d+)\.(\d+)(?=[,}\]])/u.exec(rawText);
      if (!match) {
        return null;
      }
      return [rawText.replace(match[0], ":0.1"), rawText.replace(match[0], ":0.1000000000000000055511151231257827")];
    }
  },
  {
    id: "null-to-absent",
    operatorClass: "changing",
    rationale: '"supplied and empty" and "never supplied" are different assertions.',
    apply: (rawText) => {
      const match = /,?"[^"]*":null/u.exec(rawText);
      if (!match) {
        return null;
      }
      const removed = rawText.replace(match[0], "");
      return removed === rawText ? null : removed;
    }
  }
] as const;

/* ------------------------------------------------------------- pipeline */

export interface PipelineArm {
  id: string;
  digest: (rawText: string) => string | null;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export const E1B_ARMS: readonly PipelineArm[] = [
  {
    id: "ghost-ark-receipt-schema",
    digest: (rawText) => {
      try {
        return sha256Hex(canonicalize(JSON.parse(rawText) as unknown));
      } catch {
        return null;
      }
    }
  },
  {
    id: "ghost-ark-strict-admission",
    digest: (rawText) => {
      try {
        return sha256Hex(canonicalize(parseStrictJson(rawText)));
      } catch {
        return null;
      }
    }
  }
] as const;

export interface OperatorResult {
  operatorId: string;
  operatorClass: OperatorClass;
  armId: string;
  /** Trials where the operator applied and both sides produced a digest. */
  decided: number;
  /** Trials where the operator could not apply to the drawn document. */
  inapplicable: number;
  /** Trials where at least one side was rejected (fail-closed). */
  rejected: number;
  collapsed: number;
  /**
   * For `changing` operators this is the unintended-kernel rate. For `preserving`
   * operators it is the correct-behavior rate, and 1 - rate is over-discrimination.
   *
   * Denominator is `decided` only. Do NOT use this to compare a guarded arm against an
   * unguarded one: the guarded arm rejects precisely the inputs the unguarded arm collapses,
   * so its `decided` set excludes them and its rate is computed over an easier subset. Use
   * `unsoundRate` for cross-arm comparison.
   */
  collapseRate: ProportionReport;
  /**
   * The fair cross-arm metric for `changing` operators: collapses over ALL applicable trials
   * (decided + rejected). A rejection counts as a sound outcome because no false shared
   * identity is issued, so both arms are scored over the same denominator.
   */
  unsoundRate: ProportionReport;
}

export interface E1BReport {
  schema_version: typeof E1B_REPORT_SCHEMA_VERSION;
  /** SAMPLED, not census: intervals are legitimate here and only here. */
  sample_provenance: "sampled";
  seed: number;
  trialsPerOperator: number;
  generator: GeneratorConfig;
  results: OperatorResult[];
  /** Aggregate unintended-kernel rate over all `changing` operators, per arm. */
  unintendedKernelRate: { armId: string; report: ProportionReport }[];
  non_claim: string;
}

const NON_CLAIM =
  "E1-B measures collapse rates of a parse-canonicalize-digest pipeline under the declared synthetic generator and " +
  "mutation operators recorded in this report. Its confidence intervals describe sampling variability under THAT " +
  "generator, not under production receipt traffic, and must not be quoted as a real-world frequency. It is not a " +
  "completeness result over JSON and not evidence of model safety, semantic truth, compliance, or cryptographic strength.";

export interface E1BOptions {
  seed?: number;
  trialsPerOperator?: number;
}

export function runE1BRandomized(options: E1BOptions = {}): E1BReport {
  const seed = options.seed ?? DEFAULT_SEED;
  const trialsPerOperator = options.trialsPerOperator ?? DEFAULT_TRIALS_PER_OPERATOR;
  const rng = makeRng(seed);

  const results: OperatorResult[] = [];

  for (const operator of MUTATION_OPERATORS) {
    for (const arm of E1B_ARMS) {
      results.push({
        operatorId: operator.id,
        operatorClass: operator.operatorClass,
        armId: arm.id,
        decided: 0,
        inapplicable: 0,
        rejected: 0,
        collapsed: 0,
        collapseRate: reportProportion(0, 1, "sampled", wilsonInterval),
        unsoundRate: reportProportion(0, 1, "sampled", wilsonInterval)
      });
    }
  }

  const byKey = new Map(results.map((result) => [`${result.operatorId}::${result.armId}`, result]));

  for (const operator of MUTATION_OPERATORS) {
    for (let trial = 0; trial < trialsPerOperator; trial += 1) {
      const value = randomValue(rng, 0, DECLARED_GENERATOR);
      const drawn = JSON.stringify(value);

      const pair = operator.applyPair ? operator.applyPair(drawn, value, rng) : null;
      const rawA = pair ? pair[0] : drawn;
      const rawB = pair ? pair[1] : operator.apply(drawn, value, rng);

      for (const arm of E1B_ARMS) {
        const result = byKey.get(`${operator.id}::${arm.id}`) as OperatorResult;

        if (rawB === null || rawB === rawA) {
          result.inapplicable += 1;
          continue;
        }

        const digestA = arm.digest(rawA);
        const digestB = arm.digest(rawB);

        if (digestA === null || digestB === null) {
          result.rejected += 1;
          continue;
        }

        result.decided += 1;
        if (digestA === digestB) {
          result.collapsed += 1;
        }
      }
    }
  }

  for (const result of results) {
    // A sampled proportion, so an interval is legitimate — but reportProportion still
    // suppresses it below n = 30, which is the honest behavior for a thin operator.
    result.collapseRate =
      result.decided > 0
        ? reportProportion(result.collapsed, result.decided, "sampled", wilsonInterval)
        : reportProportion(0, 1, "sampled", wilsonInterval);

    const applicable = result.decided + result.rejected;
    result.unsoundRate =
      applicable > 0
        ? reportProportion(result.collapsed, applicable, "sampled", wilsonInterval)
        : reportProportion(0, 1, "sampled", wilsonInterval);
  }

  const unintendedKernelRate = E1B_ARMS.map((arm) => {
    const changing = results.filter((result) => result.armId === arm.id && result.operatorClass === "changing");
    const collapsed = changing.reduce((total, result) => total + result.collapsed, 0);
    // Denominator is APPLICABLE trials (decided + rejected), not decided. Scoring only
    // decided trials would let a guarded arm look good by rejecting the hard cases and
    // being graded on what remained -- the two arms must face the same denominator.
    const applicable = changing.reduce((total, result) => total + result.decided + result.rejected, 0);
    return {
      armId: arm.id,
      report: applicable > 0 ? reportProportion(collapsed, applicable, "sampled", wilsonInterval) : reportProportion(0, 1, "sampled", wilsonInterval)
    };
  });

  return {
    schema_version: E1B_REPORT_SCHEMA_VERSION,
    sample_provenance: "sampled",
    seed,
    trialsPerOperator,
    generator: DECLARED_GENERATOR,
    results,
    unintendedKernelRate,
    non_claim: NON_CLAIM
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function intervalText(report: ProportionReport): string {
  if (!report.interval) {
    return `(no interval: ${report.intervalOmittedBecause ?? "unspecified"})`;
  }
  return `[${percent(report.interval.low)}, ${percent(report.interval.high)}]`;
}

function main(): void {
  const seedFlag = process.argv.indexOf("--seed");
  const trialsFlag = process.argv.indexOf("--trials");
  const report = runE1BRandomized({
    seed: seedFlag !== -1 ? Number(process.argv[seedFlag + 1]) : undefined,
    trialsPerOperator: trialsFlag !== -1 ? Number(process.argv[trialsFlag + 1]) : undefined
  });

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E1-B randomized kernel probe (${report.schema_version})`);
  lines.push(`provenance: ${report.sample_provenance} — confidence intervals ARE legitimate here (random draws from a declared generator)`);
  lines.push(`seed: ${report.seed} (deterministic; re-run with --seed to replay) | ${report.trialsPerOperator} trials/operator`);
  lines.push(`generator: depth<=${report.generator.maxDepth}, keys<=${report.generator.maxKeysPerObject}, array<=${report.generator.maxArrayLength}`);
  lines.push("");

  for (const operatorClass of ["changing", "preserving"] as const) {
    const heading =
      operatorClass === "changing"
        ? "CHANGING operators — a collapse here is an UNINTENDED KERNEL MEMBER"
        : "PRESERVING operators — a collapse here is CORRECT; a split is over-discrimination";
    lines.push(heading);
    lines.push(
      operatorClass === "changing"
        ? "  operator                          arm                         decided rejected collapsed  UNSOUND  95% Wilson (denominator = decided + rejected)"
        : "  operator                          arm                         decided rejected collapsed  correct  95% Wilson (denominator = decided)"
    );
    for (const result of report.results.filter((entry) => entry.operatorClass === operatorClass)) {
      const shown = operatorClass === "changing" ? result.unsoundRate : result.collapseRate;
      lines.push(
        `  ${result.operatorId.padEnd(33)} ${result.armId.padEnd(27)} ${String(result.decided).padStart(7)} ${String(result.rejected).padStart(8)} ${String(result.collapsed).padStart(9)}  ${percent(shown.observed).padStart(6)}  ${intervalText(shown)}`
      );
    }
    lines.push("");
  }

  lines.push("AGGREGATE unsound-outcome rate over all changing operators (rejection counts as SOUND; both arms share the denominator):");
  for (const entry of report.unintendedKernelRate) {
    lines.push(`  ${entry.armId.padEnd(30)} ${entry.report.successes}/${entry.report.total} = ${percent(entry.report.observed)}  95% Wilson ${intervalText(entry.report)}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);

  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main();
}
