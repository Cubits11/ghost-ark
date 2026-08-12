#!/usr/bin/env node
/**
 * Generates the standalone `kernel-probe.mjs` from this repository's sources.
 *
 * WHY GENERATED RATHER THAN HAND-MAINTAINED
 *
 * A standalone copy is a fork, and a fork drifts. This repository has spent
 * considerable effort on exactly that failure: a figure measured once, quoted in
 * several documents, then corrected in one of them. A hand-copied pathology
 * alphabet would rot the same way, and worse — silently, in the one artifact
 * intended for people who do not have this repository to check it against.
 *
 * So the alphabet is not copied. It is emitted by the existing, tested
 * `--emit-alphabet` path and embedded verbatim.
 *
 * The ~40 lines of verdict logic ARE hand-ported, because inverting the
 * dependency (making the standalone the source of truth for E1) would mean
 * editing the census, and E1 is pre-registered. That port is pinned two ways by
 * `tests/unit/repo-hygiene/kernelProbeStandalone.test.ts`:
 *
 *   1. regenerating must produce a byte-identical file (no uncommitted drift);
 *   2. both implementations must return IDENTICAL verdicts for every pathology
 *      against a real canonicalizer — E5's differential-agreement design turned
 *      on this project's own two implementations.
 *
 * Usage:  node tools/kernel-probe/build-standalone.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUTPUT = resolve(HERE, "kernel-probe.mjs");

/** Pull the alphabet through the path that already ships and is already tested. */
function emitAlphabet() {
  const raw = execFileSync(
    "npx",
    ["ts-node", "tools/experiments/kernelProbe.ts", "--emit-alphabet"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("build-standalone: --emit-alphabet returned no classes");
  }
  for (const entry of parsed) {
    for (const field of ["id", "description", "rawA", "rawB", "intent", "consumerRationale"]) {
      if (typeof entry[field] !== "string") {
        throw new Error(`build-standalone: class ${entry.id} is missing ${field}`);
      }
    }
    if (entry.rawA === entry.rawB) {
      throw new Error(`build-standalone: class ${entry.id} has identical sides`);
    }
  }
  return parsed;
}

/** Read the non-claim from the source of truth rather than restating it. */
function extractNonClaim() {
  const source = readFileSync(resolve(REPO_ROOT, "tools/experiments/kernelProbe.ts"), "utf8");
  const match = /const NON_CLAIM =\n([\s\S]*?);\n/u.exec(source);
  if (!match) throw new Error("build-standalone: could not locate NON_CLAIM in kernelProbe.ts");
  // The literal is a concatenation of quoted fragments; evaluate it as data.
  const fragments = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/gu)].map((m) =>
    m[1].replace(/\\"/gu, '"').replace(/\\\\/gu, "\\")
  );
  const text = fragments.join("");
  if (text.length < 100) throw new Error("build-standalone: NON_CLAIM extraction looks wrong");
  return text;
}

const alphabet = emitAlphabet();
const nonClaim = extractNonClaim();

const BANNER = `#!/usr/bin/env node
// kernel-probe — report which distinctions a canonicalizer destroys.
//
// GENERATED FILE. Do not edit by hand.
//   source:    tools/experiments/kernelProbe.ts + tools/experiments/kernelAlphabet.ts
//   generator: tools/kernel-probe/build-standalone.mjs
//   pinned by: tests/unit/repo-hygiene/kernelProbeStandalone.test.ts
//
// Self-contained on purpose. No dependencies, no install, no build step, and
// nothing from the repository it was generated in. Copy this one file anywhere
// a modern Node can run and point it at your canonicalizer:
//
//     node kernel-probe.mjs --command "jq -S -c ."
//
// It needs no receipt, no AWS, no account, and no agreement with the
// conclusions of the project that produced it. If it tells you something
// uncomfortable about your canonicalizer, that finding is yours and it does not
// depend on trusting anyone.
//
// Provenance: https://github.com/PSUCyberSecurityLab/ghost-ark
`;

// One String.raw template for the whole body, so `\n` survives into the output
// as an escape rather than a real newline. Backticks inside it are written as
// @@BT@@ and substituted at the end: concatenating a raw template with a plain
// one silently drops raw semantics for every chunk after the join, which is how
// the first version of this generator emitted a file with an unterminated
// string literal.
const BODY = String.raw`
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const KERNEL_PROBE_SCHEMA_VERSION = "ghost.kernel_probe.v1";

const NON_CLAIM = ${JSON.stringify(nonClaim)};

/**
 * The pre-registered pathology alphabet.
 *
 * Each class is a pair of byte-distinct raw JSON texts plus a CONSUMER INTENT
 * fixed before any implementation was run. The intent is what makes a collapse
 * "unintended" rather than merely "observed" — without it, this tool would only
 * report that two documents hashed the same, which is not a finding.
 *
 *   intent "distinct"    at least one declared consumer must be able to tell the
 *                        two documents apart. A canonicalizer that maps them to
 *                        one digest has an UNINTENDED KERNEL MEMBER.
 *   intent "equivalent"  every declared consumer treats them as one fact. A
 *                        canonicalizer that maps them to two digests
 *                        OVER-DISCRIMINATES, which breaks re-verification of
 *                        semantically unchanged evidence.
 *
 * You are meant to disagree with some of these. The rationale is printed with
 * every finding so you can: if your consumers genuinely do not distinguish a
 * pair, that row is not a defect in your canonicalizer, and the honest move is
 * to say so rather than to change the intent to match a result.
 */
export const PATHOLOGY_ALPHABET = ${JSON.stringify(alphabet, null, 2)};

/**
 * sha256 of the exact byte stream --emit-alphabet writes. Every report records
 * an alphabet hash so two reports are comparable exactly when they ran the same
 * corpus bytes: a file produced by --emit-alphabet hashes identically to the
 * built-in, and anything else is conservatively NOT assumed comparable. The
 * hash is over bytes rather than a canonical form on purpose — a canonical form
 * would have its own kernel, which is this tool's entire subject.
 */
export const BUILT_IN_ALPHABET_SHA256 = createHash("sha256")
  .update(JSON.stringify(PATHOLOGY_ALPHABET, null, 2) + "\n", "utf8")
  .digest("hex");

/**
 * Validates a supplied corpus against the exact schema --emit-alphabet writes.
 *
 * FAIL-CLOSED: any malformed class aborts the whole probe with a specific
 * message. Silently skipping a class would misreport the census — a report
 * over 30 of a caller's 31 classes reads as a report over all 31, and the
 * dropped one is invisible precisely to the person relying on it.
 */
export function validateSuppliedAlphabet(parsed, label) {
  if (!Array.isArray(parsed)) {
    throw new Error("kernel-probe: alphabet " + label + " must be a JSON array of pathology classes");
  }
  if (parsed.length === 0) {
    throw new Error("kernel-probe: alphabet " + label + " contains no pathology classes");
  }
  const seen = new Set();
  parsed.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("kernel-probe: alphabet " + label + " entry " + index + " is not an object");
    }
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new Error("kernel-probe: alphabet " + label + " entry " + index + " has no string \"id\"");
    }
    const where = "class \"" + entry.id + "\"";
    if (seen.has(entry.id)) {
      throw new Error("kernel-probe: alphabet " + label + " has duplicate pathology id \"" + entry.id + "\"");
    }
    seen.add(entry.id);
    for (const field of ["description", "rawA", "rawB", "consumerRationale"]) {
      if (typeof entry[field] !== "string") {
        throw new Error("kernel-probe: alphabet " + label + " " + where + " is missing string field \"" + field + "\"");
      }
    }
    if (entry.rawA === entry.rawB) {
      throw new Error(
        "kernel-probe: alphabet " + label + " " + where +
        " is not a pair of two documents: rawA and rawB are byte-identical"
      );
    }
    if (entry.intent === undefined) {
      throw new Error(
        "kernel-probe: alphabet " + label + " " + where +
        " has no intent; every class must pre-register \"distinct\" or \"equivalent\""
      );
    }
    if (entry.intent !== "distinct" && entry.intent !== "equivalent") {
      throw new Error(
        "kernel-probe: alphabet " + label + " " + where + " has unknown intent " +
        JSON.stringify(entry.intent) + "; must be \"distinct\" or \"equivalent\""
      );
    }
  });
}

/** Reads, parses, and validates a caller-supplied corpus file. */
function loadSuppliedAlphabet(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    const reason = error && error.code ? error.code : "unreadable";
    throw new Error("kernel-probe: cannot read alphabet file " + path + " (" + reason + ")");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error("kernel-probe: alphabet file " + path + " is not valid JSON: " + error.message);
  }
  validateSuppliedAlphabet(parsed, "file " + path);
  return {
    alphabet: parsed,
    source: {
      kind: "supplied",
      path: path,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }
  };
}

/**
 * Runs the target once. A NON-ZERO EXIT IS A REJECTION, NOT AN ERROR.
 *
 * This distinction is the one every previous version of this measurement got
 * wrong at least once: a canonicalizer that refuses malformed input is behaving
 * well, and scoring that as a failure — or as agreement — misreports it. What is
 * genuinely an error (the command does not exist) throws.
 */
export function runTarget(command, args, rawJson) {
  let stdout;
  try {
    stdout = execFileSync(command, [...args], {
      input: rawJson,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "ignore"]
    });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("kernel-probe: command not found: " + command);
    }
    const status = error && error.status !== undefined && error.status !== null ? error.status : "signal";
    return { status: "rejected", reason: "exit " + status };
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

/**
 * Maps a pair of outcomes plus the declared intent onto a verdict.
 *
 * Ported from tools/experiments/e1KernelCensus.ts. The port is held to identical
 * behaviour by a differential test, because two implementations of one rule is
 * exactly the situation that produces a silent disagreement.
 */
export function classify(intent, outcomeA, outcomeB) {
  const aRejected = outcomeA.status === "rejected";
  const bRejected = outcomeB.status === "rejected";

  if (aRejected && bRejected) {
    return { observed: "rejected-both", verdict: "fail-closed" };
  }

  if (aRejected !== bRejected) {
    // One side admitted, one refused. The verdict depends entirely on intent.
    //
    // "distinct":   no false shared identity was issued — the goal state for
    //               admission control, reached by refusal rather than by
    //               discrimination.
    // "equivalent": two documents every consumer treats as one fact, and only
    //               one was accepted. That is an availability failure and a real
    //               cost of a strict rule, not a win.
    return {
      observed: "rejected-one",
      verdict: intent === "distinct" ? "sound-by-rejection" : "rejection-asymmetry"
    };
  }

  const collapsed = outcomeA.digest === outcomeB.digest;
  if (collapsed) {
    return { observed: "collapsed", verdict: intent === "distinct" ? "unintended-kernel" : "sound" };
  }
  return { observed: "distinct", verdict: intent === "equivalent" ? "over-discrimination" : "sound" };
}

export function probeKernel(command, args = [], alphabet = PATHOLOGY_ALPHABET, runner = runTarget, alphabetSource = undefined) {
  const seen = new Set();
  for (const entry of alphabet) {
    if (seen.has(entry.id)) throw new Error("kernel-probe: duplicate pathology id " + entry.id);
    seen.add(entry.id);
    if (entry.rawA === entry.rawB) {
      throw new Error("kernel-probe: pathology " + entry.id + " has identical sides");
    }
  }

  const cells = [];
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
  };
  for (const cell of cells) counts[cell.verdict] += 1;

  // Record which alphabet actually ran. Callers that load a file pass the
  // file-byte hash explicitly; programmatic callers get an honest default —
  // never a "built-in" label on a corpus that is not the built-in one.
  const source =
    alphabetSource !== undefined
      ? alphabetSource
      : alphabet === PATHOLOGY_ALPHABET
        ? { kind: "built-in", sha256: BUILT_IN_ALPHABET_SHA256 }
        : {
            kind: "supplied",
            path: null,
            sha256: createHash("sha256").update(JSON.stringify(alphabet, null, 2) + "\n", "utf8").digest("hex")
          };

  return {
    schema_version: KERNEL_PROBE_SCHEMA_VERSION,
    target: [command, ...args].join(" "),
    sample_provenance: "census",
    alphabet_size: alphabet.length,
    alphabet_source: source,
    counts,
    unintended_kernel_members: cells.filter((c) => c.verdict === "unintended-kernel").map((c) => c.pathologyId),
    over_discriminated: cells.filter((c) => c.verdict === "over-discrimination").map((c) => c.pathologyId),
    cells,
    non_claim: NON_CLAIM
  };
}

const USAGE = @@BT@@kernel-probe — report which distinctions a canonicalizer destroys

USAGE
  node kernel-probe.mjs --command "<program> [args...]" [--alphabet <file>] [--json] [--fail-on-kernel]
  node kernel-probe.mjs --emit-alphabet

CONTRACT FOR <program>
  stdin     one raw JSON document
  stdout    its canonical form (SHA-256 is computed here, not by the program)
  exit 0    accepted
  exit !=0  rejected (a legitimate answer, scored separately from a collapse)

OPTIONS
  --command         the canonicalizer to probe (required unless --emit-alphabet)
  --alphabet <file> probe a corpus of your own instead of the built-in one.
                    Accepts exactly the JSON --emit-alphabet writes. The corpus
                    is validated before anything runs, and one malformed class
                    aborts the whole probe rather than being silently skipped.
                    The report records the file's sha256, so reports over
                    different corpora are not silently compared.
  --json            emit the full machine-readable report
  --fail-on-kernel  exit 1 if any unintended kernel member is found
  --emit-alphabet   write the pathology corpus as JSON and exit, so it can be
                    run in any language without this file

EXAMPLES
  node kernel-probe.mjs --command "jq -S -c ."
  node kernel-probe.mjs --command "./my-canonicalizer" --json
  node kernel-probe.mjs --emit-alphabet > pathologies.json
  node kernel-probe.mjs --alphabet my-pathologies.json --command "jq -S -c ."

READING THE OUTPUT
  UNINTENDED-KERNEL     two documents a declared consumer distinguishes, which
                        your canonicalizer gives one identity. Usually the row
                        that matters.
  OVER-DISCRIMINATION   two documents every declared consumer treats as one
                        fact, which your canonicalizer splits. Breaks
                        re-verification of unchanged evidence.
  FAIL-CLOSED           both sides refused. Often correct.
  SOUND-BY-REJECTION    one side refused, and the pair was meant to be
                        distinguishable. Admission control doing its job.
  REJECTION-ASYMMETRY   one side refused, and the pair was meant to be
                        equivalent. An availability cost.
@@BT@@;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  if (process.argv.includes("--emit-alphabet")) {
    process.stdout.write(JSON.stringify(PATHOLOGY_ALPHABET, null, 2) + "\n");
    return;
  }

  const target = argValue("--command");
  if (!target || process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(USAGE);
    process.exitCode = target ? 0 : 2;
    return;
  }

  let alphabet = PATHOLOGY_ALPHABET;
  let alphabetSource; // undefined -> probeKernel records the built-in source
  if (process.argv.includes("--alphabet")) {
    const alphabetPath = argValue("--alphabet");
    if (!alphabetPath || alphabetPath.startsWith("--")) {
      process.stderr.write("kernel-probe: --alphabet requires a file path\n");
      process.exitCode = 2;
      return;
    }
    let loaded;
    try {
      loaded = loadSuppliedAlphabet(alphabetPath);
    } catch (error) {
      process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
      process.exitCode = 2;
      return;
    }
    alphabet = loaded.alphabet;
    alphabetSource = loaded.source;
  }

  // Split on whitespace so --command "jq -S -c ." works. Deliberately NOT passed
  // through a shell: this tool is meant to be safe to point at a target without
  // also handing that target a shell.
  const parts = target.trim().split(/\s+/u);
  const report = probeKernel(parts[0], parts.slice(1), alphabet, runTarget, alphabetSource);

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const lines = [];
    lines.push("kernel-probe (" + report.schema_version + ")");
    lines.push("target: " + report.target);
    lines.push("alphabet: " + report.alphabet_size + " classes | provenance: census (no confidence intervals)");
    lines.push(
      "alphabet-source: " +
      (report.alphabet_source.kind === "built-in"
        ? "built-in"
        : "supplied (" + report.alphabet_source.path + ")") +
      " sha256=" + report.alphabet_source.sha256
    );
    lines.push("");
    lines.push(
      "sound " + report.counts.sound +
      " | UNINTENDED-KERNEL " + report.counts["unintended-kernel"] +
      " | over-discrimination " + report.counts["over-discrimination"] +
      " | fail-closed " + report.counts["fail-closed"] +
      " | sound-by-rejection " + report.counts["sound-by-rejection"] +
      " | rejection-asymmetry " + report.counts["rejection-asymmetry"]
    );
    lines.push("");
    lines.push(
      "UNINTENDED KERNEL MEMBERS (" + report.unintended_kernel_members.length +
      ") — pairs a declared consumer distinguishes but this canonicalizer identifies:"
    );
    for (const cell of report.cells.filter((c) => c.verdict === "unintended-kernel")) {
      lines.push("  - " + cell.pathologyId + ": " + cell.description);
      lines.push("      who cares: " + cell.consumerRationale.split(". ")[0] + ".");
    }
    lines.push("");
    lines.push(
      "OVER-DISCRIMINATION (" + report.over_discriminated.length +
      ") — pairs every declared consumer unifies but this canonicalizer splits:"
    );
    for (const id of report.over_discriminated) lines.push("  - " + id);
    lines.push("");
    lines.push("NON-CLAIM: " + report.non_claim);
    process.stdout.write(lines.join("\n") + "\n");
  }

  if (process.argv.includes("--fail-on-kernel") && report.unintended_kernel_members.length > 0) {
    process.exitCode = 1;
  }
}

// Resolve both sides rather than string-munging the URL: the naive comparison
// breaks on Windows path separators and on symlinked invocations.
const invokedDirectly =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main();
}
`;

writeFileSync(OUTPUT, (BANNER + BODY).replaceAll("@@BT@@", "`"), "utf8");
process.stdout.write(
  `wrote ${OUTPUT}\n  ${alphabet.length} pathology classes embedded\n` +
    `  ${(BANNER + BODY).split("\n").length} lines, zero dependencies\n`
);
