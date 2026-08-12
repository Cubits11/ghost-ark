/**
 * E13 — Is the canonicalization kernel compositional? (Arm F of the
 * Observability Gap program.)
 *
 * THE QUESTION
 * ------------
 * Evidence crosses hops. A receipt is canonicalized and signed at a gateway,
 * transported, re-parsed by a consumer, and re-canonicalized before comparison.
 * Each hop has its own `parse . canonicalize` and therefore its own kernel. The
 * conjecture the program registered, to be decided rather than assumed:
 *
 *   Kernel is NOT compositional. Soundness of a chain cannot be inferred from
 *   soundness of its links, in either direction.
 *
 * WHY IT COULD BE TRUE AT ALL
 * ---------------------------
 * Soundness is not a property of a canonicalizer. It is a property of a
 * canonicalizer RELATIVE TO AN INPUT ALPHABET. In a chain, the second hop is
 * never evaluated on the alphabet it was tested against: it is evaluated on the
 * FIRST HOP'S IMAGE of that alphabet. Composition changes the alphabet the
 * downstream hop faces. That is the layering thesis of this program, restated
 * one level up: a property established over one layer does not carry to another.
 *
 * WHAT THIS FILE DOES, IN TWO PARTS
 * ---------------------------------
 * Part 1 settles the abstract question by EXHAUSTIVE ENUMERATION over a finite
 * model — every function from a four-document domain into that domain plus a
 * rejection symbol, and every ordered composition of two of them. Existence
 * results transfer out of a finite model unchanged, because a witness is a
 * witness. Part 1 also checks the one proposition that looks like a theorem,
 * and it is checked rather than assumed:
 *
 *   REPAIR IMPOSSIBILITY. If a hop collapses two documents without rejecting
 *   them, no downstream hop can separate them again. It can only pass the
 *   collapse along, or refuse. Downstream auditing cannot recover an upstream
 *   loss; it can only decline to build on it.
 *
 * Part 2 asks whether the abstract possibility is EXERCISED BY REAL SOFTWARE,
 * by composing every ordered pair of the canonicalization pipelines available
 * on this machine over the pre-registered E1 alphabet, and grading with E1's own
 * `classify` so no result is graded on a different curve.
 *
 * THE HARNESS CARRIES BYTES, NOT STRINGS
 * --------------------------------------
 * The alphabet's own inputs are pure ASCII: a lone surrogate is written as the
 * six characters `\ud800`, not as a surrogate, so passing INPUTS as strings
 * would be safe. The INTERMEDIATES are not, and they are the whole risk.
 *
 * Measured while building this: one hop emits the WTF-8 octets `ED A0 80`, and
 * a Buffer -> string -> Buffer round trip turns those into
 * `EF BF BD EF BF BD EF BF BD`. A string-carrying harness would have replaced
 * the surrogate on both sides of the pair, scored a clean collapse, and erased
 * the single forward counterexample this arm found. Every intermediate here is
 * a `Buffer`. This is the E4 discriminator applied to Arm F's own harness, the
 * same way E12 applies it to Arm E's.
 *
 * THE TRAP THIS ARM WAS WARNED ABOUT
 * ----------------------------------
 * The program document says Arm F is justified only if it produces a
 * counterexample that surprises, and that a bounded search finding nothing is a
 * publishable result that should be recorded rather than dressed up. Both
 * outcomes are emitted here in the same shape.
 *
 * NON-CLAIM: E13 measures composition behaviour of a bounded set of
 * canonicalization pipelines over one hand-curated alphabet, plus an exhaustive
 * enumeration over a four-element finite model. It is not a statement that any
 * implementation is defective, not a security review, not exhaustive over
 * pipelines or over JSON, and not evidence about semantic safety, compliance, or
 * the correctness of any deployment.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { PATHOLOGY_ALPHABET, assertAlphabetWellFormed, type PathologyClass } from "./kernelAlphabet";
import { classify, type CensusVerdict } from "./e1KernelCensus";
import { scanRawJson } from "./rawJsonScan";
import type { ArmOutcome } from "./canonicalizerArms";

export const E13_REPORT_SCHEMA_VERSION = "ghost.e13_kernel_composition.v1";

/**
 * `js-yaml` ships no type declarations and this repository is feature-frozen,
 * so its dependency manifest is not edited to add `@types/js-yaml` for one
 * measurement. The surface actually used is one function, declared here.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadYaml = (require("js-yaml") as { load: (text: string) => unknown }).load;

/* -------------------------------------------------------------------------- */
/* Verdict polarity                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Verdicts that mean "no false shared identity and no false split was issued".
 *
 * `fail-closed` and `sound-by-rejection` are here because refusing is a correct
 * answer: the consumer is not handed a wrong identity. This is E1's polarity,
 * imported rather than re-decided.
 */
const ACCEPTABLE_VERDICTS: ReadonlySet<CensusVerdict> = new Set<CensusVerdict>([
  "sound",
  "fail-closed",
  "sound-by-rejection"
]);

export function isAcceptable(verdict: CensusVerdict): boolean {
  return ACCEPTABLE_VERDICTS.has(verdict);
}

/* -------------------------------------------------------------------------- */
/* PART 1 — exhaustive enumeration over a finite model                        */
/* -------------------------------------------------------------------------- */

/** Rejection, distinct from every document. */
const BOTTOM = -1;

export interface FiniteModelResult {
  domainSize: number;
  functionCount: number;
  orderedPairCount: number;
  /**
   * Both hops acceptable on the model alphabet, composite not. The conjecture's
   * forward direction.
   */
  soundPlusSoundGivesUnsound: number;
  /** An unacceptable hop whose composite is acceptable. The reverse direction. */
  unsoundHopGivesSoundChain: number;
  /**
   * Chains where an upstream collapse was SEPARATED downstream. Must be zero.
   * A non-zero here refutes repair impossibility and is the more important
   * finding of the two.
   */
  repairBySeparation: number;
  /** Chains where an upstream collapse was neutralized by downstream rejection. */
  repairByRejection: number;
  witnessForward: string | null;
  witnessReverse: string | null;
}

/**
 * Enumerates every hop on a four-document domain and every ordered composition.
 *
 * A hop is a total function from {0,1,2,3} to {0,1,2,3} + {reject}, which is
 * exactly what a canonicalizer is once its output is reduced to an identity:
 * either a canonical form, or a refusal. 5^4 = 625 hops, 390,625 ordered pairs.
 *
 * The model alphabet declares one pair that must stay distinct and one that must
 * collapse, so both failure polarities — unintended kernel and
 * over-discrimination — are in scope.
 */
export function enumerateFiniteModel(): FiniteModelResult {
  const domainSize = 4;
  const outputs = [BOTTOM, 0, 1, 2, 3];

  const functions: number[][] = [];
  for (const a of outputs) {
    for (const b of outputs) {
      for (const c of outputs) {
        for (const d of outputs) {
          functions.push([a, b, c, d]);
        }
      }
    }
  }

  const alphabet: { left: number; right: number; intent: "distinct" | "equivalent" }[] = [
    { left: 0, right: 1, intent: "distinct" },
    { left: 2, right: 3, intent: "equivalent" }
  ];

  const outcomeOf = (value: number): ArmOutcome =>
    value === BOTTOM
      ? { status: "rejected", reason: "model rejection" }
      : { status: "digest", digest: `d${value}`, canonicalForm: `d${value}` };

  const verdictsFor = (hop: readonly number[]): CensusVerdict[] =>
    alphabet.map((pair) => classify(pair.intent, outcomeOf(hop[pair.left] as number), outcomeOf(hop[pair.right] as number)).verdict);

  const acceptableFor = (hop: readonly number[]): boolean => verdictsFor(hop).every(isAcceptable);

  const compose = (first: readonly number[], second: readonly number[]): number[] =>
    // Rejection is absorbing: a refused document does not continue down the chain.
    first.map((value) => (value === BOTTOM ? BOTTOM : (second[value] as number)));

  let soundPlusSoundGivesUnsound = 0;
  let unsoundHopGivesSoundChain = 0;
  let repairBySeparation = 0;
  let repairByRejection = 0;
  let witnessForward: string | null = null;
  let witnessReverse: string | null = null;

  const describe = (hop: readonly number[]): string =>
    `[${hop.map((value) => (value === BOTTOM ? "reject" : String(value))).join(",")}]`;

  for (const first of functions) {
    const firstAcceptable = acceptableFor(first);
    for (const second of functions) {
      const composite = compose(first, second);
      const compositeAcceptable = acceptableFor(composite);
      const secondAcceptable = acceptableFor(second);

      if (firstAcceptable && secondAcceptable && !compositeAcceptable) {
        soundPlusSoundGivesUnsound += 1;
        witnessForward ??= `hop1=${describe(first)} hop2=${describe(second)} composite=${describe(composite)}`;
      }

      if ((!firstAcceptable || !secondAcceptable) && compositeAcceptable) {
        unsoundHopGivesSoundChain += 1;
        witnessReverse ??= `hop1=${describe(first)} hop2=${describe(second)} composite=${describe(composite)}`;
      }

      // Repair impossibility, checked pairwise over the whole domain rather
      // than only over the declared alphabet: once two documents share a
      // non-rejected canonical form, nothing downstream can tell them apart.
      for (let left = 0; left < domainSize; left += 1) {
        for (let right = left + 1; right < domainSize; right += 1) {
          const collapsedUpstream = first[left] === first[right] && first[left] !== BOTTOM;
          if (!collapsedUpstream) {
            continue;
          }
          const compositeLeft = composite[left] as number;
          const compositeRight = composite[right] as number;
          if (compositeLeft === BOTTOM && compositeRight === BOTTOM) {
            repairByRejection += 1;
          } else if (compositeLeft !== compositeRight) {
            repairBySeparation += 1;
          }
        }
      }
    }
  }

  return {
    domainSize,
    functionCount: functions.length,
    orderedPairCount: functions.length * functions.length,
    soundPlusSoundGivesUnsound,
    unsoundHopGivesSoundChain,
    repairBySeparation,
    repairByRejection,
    witnessForward,
    witnessReverse
  };
}

/* -------------------------------------------------------------------------- */
/* PART 2 — real implementations                                              */
/* -------------------------------------------------------------------------- */

/** A hop maps raw bytes to canonical bytes, or refuses. */
export type HopOutcome = { status: "bytes"; bytes: Buffer } | { status: "rejected"; reason: string };

export interface Hop {
  id: string;
  language: string;
  description: string;
  /** Whose code this is. Arm F's generality claim depends on not blurring this. */
  origin: "third-party" | "ghost-ark";
  run: (input: Buffer) => HopOutcome;
}

const TRANSIENT_SPAWN_CODES = new Set(["ETIMEDOUT", "EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ENOMEM"]);

/**
 * Runs a subprocess hop with BUFFER input and BUFFER output.
 *
 * The buffers are the point. `execFileSync` with a string input encodes it as
 * UTF-8, and encoding a JavaScript string that holds an unpaired surrogate
 * replaces it with U+FFFD — silently converting the `lone-surrogate-escape`
 * class into its own control before any arm sees it.
 */
function spawnHop(file: string, args: string[], input: Buffer): HopOutcome {
  const attempt = (): Buffer =>
    execFileSync(file, args, {
      input,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"]
    });

  let stdout: Buffer;
  try {
    stdout = attempt();
  } catch (error) {
    const failure = error as { code?: string; status?: number | null };
    if (typeof failure.code === "string" && TRANSIENT_SPAWN_CODES.has(failure.code)) {
      try {
        stdout = attempt();
      } catch (retryError) {
        const retryFailure = retryError as { status?: number | null };
        return { status: "rejected", reason: `exit ${retryFailure.status ?? "signal"}` };
      }
    } else {
      return { status: "rejected", reason: `exit ${failure.status ?? "signal"}` };
    }
  }

  // A trailing newline is a printer artifact, not canonical content.
  let end = stdout.length;
  while (end > 0 && stdout[end - 1] === 0x0a) {
    end -= 1;
  }
  const trimmed = stdout.subarray(0, end);
  if (trimmed.length === 0) {
    return { status: "rejected", reason: "no canonical output" };
  }
  return { status: "bytes", bytes: Buffer.from(trimmed) };
}

function probe(file: string, args: string[]): boolean {
  try {
    execFileSync(file, args, { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

const PYTHON_SORTED =
  "import json,sys;sys.stdout.write(json.dumps(json.loads(sys.stdin.buffer.read().decode('utf-8',errors='surrogatepass')),sort_keys=True,separators=(',',':')))";
const PYTHON_ASCII_OFF =
  "import json,sys;sys.stdout.buffer.write(json.dumps(json.loads(sys.stdin.buffer.read().decode('utf-8',errors='surrogatepass')),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf-8',errors='surrogatepass'))";
const PYTHON_ASCII_OFF_DEFAULT =
  "import json,sys;sys.stdout.buffer.write(json.dumps(json.loads(sys.stdin.buffer.read().decode('utf-8')),sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf-8'))";
const NODE_RESTRINGIFY =
  "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8'))))";
const RUBY_SORTED =
  "require 'json';o=JSON.parse(STDIN.read);print JSON.generate(o.is_a?(Hash) ? o.sort.to_h : o)";

/**
 * The hops available on this machine.
 *
 * Every one is a canonicalization step a real pipeline actually performs. The
 * YAML hop is not a curiosity: Kubernetes manifests, GitHub Actions workflows
 * and in-toto layouts are routinely read by a YAML parser even when the bytes
 * on the wire are JSON, and JSON is a YAML subset, so that hop is a real one.
 */
export function buildHops(): Hop[] {
  const hops: Hop[] = [];

  if (probe("jq", ["--version"])) {
    hops.push({
      id: "jq-sorted",
      language: "C (jq)",
      description: "jq -S -c . — parse, sort object keys, emit compactly",
      origin: "third-party",
      run: (input) => spawnHop("jq", ["-S", "-c", "."], input)
    });
    hops.push({
      id: "jq-identity",
      language: "C (jq)",
      description: "jq -c . — parse and re-emit compactly, member order preserved",
      origin: "third-party",
      run: (input) => spawnHop("jq", ["-c", "."], input)
    });
  }

  if (probe("python3", ["--version"])) {
    hops.push({
      id: "python-sorted",
      language: "Python (CPython json)",
      description: "json.dumps(sort_keys=True, separators) with ASCII escaping",
      origin: "third-party",
      run: (input) => spawnHop("python3", ["-c", PYTHON_SORTED], input)
    });
    // TWO variants, and the pair is the point. The permissive one is the only
    // hop in this set that produces a forward counterexample, and it does so
    // BECAUSE of the `surrogatepass` error handler — which is a configuration
    // chosen by this harness, not a CPython default. The default variant sits
    // beside it so a reader of the report cannot mistake the counterexample for
    // something that arises out of the box.
    hops.push({
      id: "python-utf8-surrogatepass",
      language: "Python (CPython json)",
      description:
        "json.dumps(sort_keys=True, ensure_ascii=False) with errors='surrogatepass' — a PERMISSIVE, non-default " +
        "configuration that re-encodes an unpaired surrogate as raw WTF-8 bytes instead of refusing",
      origin: "third-party",
      run: (input) => spawnHop("python3", ["-c", PYTHON_ASCII_OFF], input)
    });
    hops.push({
      id: "python-utf8-default",
      language: "Python (CPython json)",
      description: "json.dumps(sort_keys=True, ensure_ascii=False) with CPython's DEFAULT strict codec",
      origin: "third-party",
      run: (input) => spawnHop("python3", ["-c", PYTHON_ASCII_OFF_DEFAULT], input)
    });
  }

  if (probe("ruby", ["--version"])) {
    hops.push({
      id: "ruby-sorted",
      language: "Ruby (stdlib json)",
      description: "JSON.parse then JSON.generate over sorted top-level members",
      origin: "third-party",
      run: (input) => spawnHop("ruby", ["-e", RUBY_SORTED], input)
    });
  }

  hops.push({
    id: "node-restringify",
    language: "JavaScript (V8)",
    description: "JSON.stringify(JSON.parse(x)) — the transport re-serialization every JS consumer performs",
    origin: "third-party",
    run: (input) => spawnHop(process.execPath, ["-e", NODE_RESTRINGIFY], input)
  });

  hops.push({
    id: "yaml-roundtrip",
    language: "JavaScript (js-yaml)",
    description: "js-yaml load then JSON.stringify — the hop taken whenever JSON is read by a YAML parser",
    origin: "third-party",
    run: (input) => {
      try {
        const value = loadYaml(input.toString("utf8")) as unknown;
        const text = JSON.stringify(value);
        if (text === undefined) {
          return { status: "rejected", reason: "value is not representable as JSON" };
        }
        return { status: "bytes", bytes: Buffer.from(text, "utf8") };
      } catch (error) {
        return { status: "rejected", reason: error instanceof Error ? error.message.split("\n")[0] : "yaml error" };
      }
    }
  });

  hops.push({
    id: "strict-duplicate-gate",
    language: "TypeScript (this repository)",
    description:
      "Layer-correct admission control: reject any document whose RAW BYTES carry a duplicate member name, else pass the bytes through unchanged",
    origin: "ghost-ark",
    run: (input) => {
      const scan = scanRawJson(new Uint8Array(input));
      if (!scan.wellFormed) {
        return { status: "rejected", reason: scan.malformedReason ?? "malformed" };
      }
      if (scan.counts["duplicate-member-name"] > 0) {
        return { status: "rejected", reason: "duplicate member name in the raw bytes" };
      }
      return { status: "bytes", bytes: input };
    }
  });

  return hops;
}

/* -------------------------------------------------------------------------- */
/* Composition over the real alphabet                                         */
/* -------------------------------------------------------------------------- */

function digestOf(outcome: HopOutcome): ArmOutcome {
  return outcome.status === "rejected"
    ? { status: "rejected", reason: outcome.reason }
    : {
        status: "digest",
        digest: createHash("sha256").update(outcome.bytes).digest("hex"),
        // `binary` is a byte-exact round trip, so the canonical form carried
        // here is the bytes the hop actually emitted.
        canonicalForm: outcome.bytes.toString("binary")
      };
}

/** Memoized hop application; the search re-applies the same hop to the same bytes often. */
function makeRunner(): (hop: Hop, input: Buffer) => HopOutcome {
  const cache = new Map<string, HopOutcome>();
  return (hop, input) => {
    const key = `${hop.id} ${input.toString("base64")}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const outcome = hop.run(input);
    cache.set(key, outcome);
    return outcome;
  };
}

export interface CompositionCell {
  pathologyId: string;
  intent: PathologyClass["intent"];
  firstHop: string;
  secondHop: string;
  firstVerdict: CensusVerdict;
  secondVerdict: CensusVerdict;
  compositeVerdict: CensusVerdict;
  /** Both hops acceptable in isolation, composite not. */
  isForwardCounterexample: boolean;
  /** At least one hop unacceptable, composite acceptable. */
  isRepair: boolean;
  /** For a repair: whether the chain refused, or genuinely separated a collapse. */
  repairMechanism: "rejection" | "separation" | null;
}

export interface E13Report {
  schema_version: typeof E13_REPORT_SCHEMA_VERSION;
  sample_provenance: "census";
  finiteModel: FiniteModelResult;
  hops: { id: string; language: string; description: string; origin: Hop["origin"] }[];
  alphabetSize: number;
  cellCount: number;
  forwardCounterexamples: CompositionCell[];
  repairs: CompositionCell[];
  /**
   * Chains that separated a pair an upstream hop had collapsed. Repair
   * impossibility says this list is empty; if it is not, the finite-model
   * result is contradicted by real software and THAT is the finding.
   */
  separationRepairs: CompositionCell[];
  /** Hops whose composition with themselves differs from applying them once. */
  nonIdempotentHops: { hopId: string; pathologyId: string; side: "A" | "B" }[];
  cells: CompositionCell[];
  non_claim: string;
}

const NON_CLAIM =
  "E13 measures composition behaviour of a bounded set of canonicalization pipelines over one hand-curated " +
  "adversarial alphabet, together with an exhaustive enumeration over a four-element finite model. It is not a " +
  "statement that any implementation is defective, not a security review, not exhaustive over pipelines or over " +
  "JSON, and not evidence about semantic safety, compliance, or the correctness of any deployment.";

export function runE13(
  alphabet: readonly PathologyClass[] = PATHOLOGY_ALPHABET,
  hops: Hop[] = buildHops()
): E13Report {
  assertAlphabetWellFormed(alphabet);
  const run = makeRunner();

  const cells: CompositionCell[] = [];
  const nonIdempotentHops: { hopId: string; pathologyId: string; side: "A" | "B" }[] = [];

  // `binary` round-trips every byte 0x00-0xFF through a JS string unchanged, so
  // an unpaired surrogate escape reaches the hop as the bytes that were written.
  const rawBytes = (text: string): Buffer => Buffer.from(text, "binary");

  for (const hop of hops) {
    for (const pathology of alphabet) {
      for (const side of ["A", "B"] as const) {
        const input = rawBytes(side === "A" ? pathology.rawA : pathology.rawB);
        const once = run(hop, input);
        if (once.status !== "bytes") {
          continue;
        }
        const twice = run(hop, once.bytes);
        if (twice.status !== "bytes" || !twice.bytes.equals(once.bytes)) {
          nonIdempotentHops.push({ hopId: hop.id, pathologyId: pathology.id, side });
        }
      }
    }
  }

  for (const first of hops) {
    for (const second of hops) {
      for (const pathology of alphabet) {
        const inputA = rawBytes(pathology.rawA);
        const inputB = rawBytes(pathology.rawB);

        const firstA = run(first, inputA);
        const firstB = run(first, inputB);
        const secondA = run(second, inputA);
        const secondB = run(second, inputB);

        const compositeA: HopOutcome = firstA.status === "bytes" ? run(second, firstA.bytes) : firstA;
        const compositeB: HopOutcome = firstB.status === "bytes" ? run(second, firstB.bytes) : firstB;

        const firstVerdict = classify(pathology.intent, digestOf(firstA), digestOf(firstB)).verdict;
        const secondVerdict = classify(pathology.intent, digestOf(secondA), digestOf(secondB)).verdict;
        const compositeVerdict = classify(pathology.intent, digestOf(compositeA), digestOf(compositeB)).verdict;

        const firstOk = isAcceptable(firstVerdict);
        const secondOk = isAcceptable(secondVerdict);
        const compositeOk = isAcceptable(compositeVerdict);

        let repairMechanism: CompositionCell["repairMechanism"] = null;
        const isRepair = (!firstOk || !secondOk) && compositeOk;
        if (isRepair) {
          const upstreamCollapsed =
            firstA.status === "bytes" && firstB.status === "bytes" && firstA.bytes.equals(firstB.bytes);
          if (upstreamCollapsed) {
            const compositeSeparated =
              compositeA.status === "bytes" &&
              compositeB.status === "bytes" &&
              !compositeA.bytes.equals(compositeB.bytes);
            repairMechanism = compositeSeparated ? "separation" : "rejection";
          } else {
            repairMechanism = "rejection";
          }
        }

        cells.push({
          pathologyId: pathology.id,
          intent: pathology.intent,
          firstHop: first.id,
          secondHop: second.id,
          firstVerdict,
          secondVerdict,
          compositeVerdict,
          isForwardCounterexample: firstOk && secondOk && !compositeOk,
          isRepair,
          repairMechanism
        });
      }
    }
  }

  return {
    schema_version: E13_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    finiteModel: enumerateFiniteModel(),
    hops: hops.map((hop) => ({
      id: hop.id,
      language: hop.language,
      description: hop.description,
      origin: hop.origin
    })),
    alphabetSize: alphabet.length,
    cellCount: cells.length,
    forwardCounterexamples: cells.filter((cell) => cell.isForwardCounterexample),
    repairs: cells.filter((cell) => cell.isRepair),
    separationRepairs: cells.filter((cell) => cell.repairMechanism === "separation"),
    nonIdempotentHops,
    cells,
    non_claim: NON_CLAIM
  };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

export function renderReport(report: E13Report): string {
  const lines: string[] = [];
  lines.push(`E13 kernel composition (${report.schema_version})`);
  lines.push(`provenance: census — curated alphabet, exact counts, no confidence intervals`);
  lines.push("");
  lines.push("PART 1 — exhaustive enumeration over a four-document finite model");
  const model = report.finiteModel;
  lines.push(`  hops enumerated: ${model.functionCount} | ordered compositions: ${model.orderedPairCount}`);
  lines.push(`  acceptable + acceptable -> UNACCEPTABLE composite : ${model.soundPlusSoundGivesUnsound}`);
  lines.push(`  unacceptable hop        -> acceptable composite   : ${model.unsoundHopGivesSoundChain}`);
  lines.push(`  upstream collapse neutralized BY REJECTION        : ${model.repairByRejection}`);
  lines.push(`  upstream collapse repaired BY SEPARATION          : ${model.repairBySeparation}  <- repair impossibility says 0`);
  if (model.witnessForward !== null) {
    lines.push(`  forward witness: ${model.witnessForward}`);
  }
  lines.push("");
  lines.push("PART 2 — real implementations");
  lines.push(`  hops: ${report.hops.length} | alphabet: ${report.alphabetSize} | cells: ${report.cellCount}`);
  for (const hop of report.hops) {
    lines.push(`    ${hop.id.padEnd(24)} ${hop.origin.padEnd(12)} ${hop.description}`);
  }
  lines.push("");
  lines.push(`  FORWARD COUNTEREXAMPLES (both hops acceptable alone, composite not): ${report.forwardCounterexamples.length}`);
  for (const cell of report.forwardCounterexamples) {
    lines.push(
      `    ${cell.firstHop} -> ${cell.secondHop} on ${cell.pathologyId} (${cell.intent}): ` +
        `${cell.firstVerdict} + ${cell.secondVerdict} => ${cell.compositeVerdict}`
    );
  }
  lines.push("");
  lines.push(`  REPAIRS (an unacceptable hop inside an acceptable chain): ${report.repairs.length}`);
  const byMechanism = new Map<string, number>();
  for (const cell of report.repairs) {
    const key = `${cell.firstHop} -> ${cell.secondHop}`;
    byMechanism.set(key, (byMechanism.get(key) ?? 0) + 1);
  }
  for (const [pair, count] of [...byMechanism.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    lines.push(`    ${pair.padEnd(52)} ${count}`);
  }
  lines.push(`  ... repaired BY SEPARATION (must be 0): ${report.separationRepairs.length}`);
  lines.push("");
  lines.push(`  NON-IDEMPOTENT hop applications: ${report.nonIdempotentHops.length}`);
  for (const entry of report.nonIdempotentHops.slice(0, 12)) {
    lines.push(`    ${entry.hopId} on ${entry.pathologyId} side ${entry.side}`);
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);
  return lines.join("\n");
}

function main(): void {
  const report = runE13();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
  }
}

if (require.main === module) {
  main();
}
