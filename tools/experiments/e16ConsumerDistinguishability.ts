/**
 * E16 — Consumer distinguishability: does a DEPLOYED, NAMED consumer reach a
 * different DECISION on a pair that a real canonicalizer collapses?
 *
 * The gap this closes
 * -------------------
 * Every other experiment in this repository establishes the STRUCTURE of the
 * provenance kernel: E1 measures which pairs Ghost-Ark's own pipeline collapses,
 * E11 shows four third-party canonicalizers collapse the same ones, E12 looks for
 * them in real traffic. But every `distinct` intent in the E1 alphabet is a
 * DECLARED consumer model — "an auditor would care", "a ledger distinguishes
 * these" — never an OBSERVED one. 00_THESIS.md §Open Gaps names this as the single
 * largest open weakness once E12 confirmed F2:
 *
 *   > no consumer has been named and shown to distinguish any pair.
 *
 * E16 answers it by execution. It takes pairs the Ghost-Ark receipt canonicalizer
 * maps to ONE digest (measured in-process here, not asserted) and feeds BOTH raw
 * documents to real, deployed, version-pinned decision engines the project did not
 * write — Open Policy Agent, CUE, jq, and CPython. For each it records the engine's
 * DECISION, not its parse. When the two decisions differ while the receipt digests
 * are equal, the result is exactly one sentence long:
 *
 *   one receipt identity, two consumer outcomes.
 *
 * What makes a decision a decision, not a parse
 * ---------------------------------------------
 * The trap this experiment is built to avoid is counting a re-serialization
 * artifact as a decision. `opa eval 'input.v'` on `{"v":1.50}` prints `1.50` and on
 * `{"v":1.5}` prints `1.5` — but that is the engine ECHOING the wire literal, not
 * deciding anything. So the decision here is always SEMANTIC numeric equality
 * against a fixed constant R:
 *
 *   R = the value the Ghost-Ark receipt actually commits to — i.e. the single
 *       number both documents resolve to under V8's parser, which is why they
 *       collapse to one digest in the first place.
 *
 * The policy is therefore the most natural one a consumer who TRUSTS the receipt
 * would write: "accept the execution whose field equals the value the receipt
 * attests." It is derived from the receipt's own canonical value, not gerrymandered
 * to the pathology.
 *
 * The DISCRIMINATOR (rule 3, the E4 principle applied to this harness)
 * -------------------------------------------------------------------
 * A harness that always reports a flip proves nothing. So the alphabet subset here
 * includes an AGREEMENT pair — `trailing-zero-fraction`, `{"v":1.50}` vs `{"v":1.5}`
 * — that is *also* collapsed by Ghost-Ark and that every consumer MUST treat
 * identically, because 1.50 and 1.5 are the same number in every one of these
 * engines. If any consumer flips on it, the harness is measuring wire bytes rather
 * than decisions and refuses to certify the run. CPython is a second, in-band
 * discriminator: it collapses `decimal-literal-collapse` (IEEE-754 double) and so
 * must NOT distinguish that pair, even though OPA/CUE/jq do — a consumer that agrees
 * with the canonicalizer on a finding pair.
 *
 * Refuse, do not degrade (rule 4), with the right asymmetry
 * ---------------------------------------------------------
 * A NULL result — "no consumer distinguishes any pair" — would be a real and
 * publishable finding (it would mean the collapses are inert in practice). But it is
 * only sound if every declared consumer actually ran: a missing engine cannot be
 * counted as "did not distinguish". So an empty finding set with any excluded
 * consumer THROWS unless `allowDegradedConsumers` is set. A POSITIVE result is
 * different: existence is monotone, so finding one distinguisher stands even if
 * another engine is absent. This is the dual of E11's universal-vs-existence logic.
 *
 * NON-CLAIM: E16 demonstrates that a real, deployed consumer CAN reach two decisions
 * on one receipt identity. It says nothing about how OFTEN this happens in
 * production — E12 measured that separately and found 0/64. It is not a security
 * review of OPA, CUE, jq, or CPython; each behaves exactly as documented. A "flip"
 * means only that the engine's number model is finer than the receipt's canonical
 * form, which is a property of the receipt, not a defect in the engine.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonicalize as receiptSchemaCanonicalize } from "../../packages/receipt-schema/src/hashCanonicalization";
import { PATHOLOGY_ALPHABET, type ConsumerIntent, type PathologyClass } from "./kernelAlphabet";

export const E16_REPORT_SCHEMA_VERSION = "ghost.e16_consumer_distinguishability.v1";

/** The decision an engine reaches on one document under the fixed `== R` policy. */
export type Decision = "accept" | "deny" | "error";

/**
 * Roles a pathology plays in E16. A pathology's E1 `intent` says whether a consumer
 * SHOULD distinguish it; its E16 role says what a distinction here MEANS.
 *
 * - `finding`      intent=distinct. A flip is a consequential unintended-kernel
 *                  member: the receipt cannot evidence which document was executed.
 * - `discriminator` intent=equivalent. Every consumer MUST agree. A flip here voids
 *                  the run — the harness would be reading bytes, not decisions.
 * - `over-discrimination` intent=equivalent. A flip is a consumer whose model is
 *                  FINER than Ghost-Ark's declared equivalence (e.g. CUE's int≠float).
 *                  Reported, but as the antitone dual, not as an unintended kernel
 *                  member — it challenges an `equivalent` pre-registration instead.
 */
export type PathologyRole = "finding" | "discriminator" | "over-discrimination";

export interface E16PairSpec {
  pathologyId: string;
  role: PathologyRole;
}

/**
 * The alphabet subset E16 exercises. Every entry is a SCALAR single-field document
 * so the `== R` policy is well-defined; structural pathologies (nested-duplicate-
 * key-in-array, duplicate-empty-key) are analogous but out of scope for a scalar
 * value policy and are noted in the coverage boundary. Each id must exist in
 * PATHOLOGY_ALPHABET; a test pins that.
 */
export const E16_PAIRS: readonly E16PairSpec[] = [
  // Findings — intent=distinct, collapsed by the Ghost-Ark receipt canonicalizer.
  { pathologyId: "decimal-literal-collapse", role: "finding" },
  { pathologyId: "integer-precision-loss", role: "finding" },
  { pathologyId: "duplicate-key-last-wins", role: "finding" },
  // Discriminator — intent=equivalent, MUST agree across every consumer.
  { pathologyId: "trailing-zero-fraction", role: "discriminator" },
  // Over-discrimination — intent=equivalent, but a finer-typed consumer may split.
  { pathologyId: "float-vs-integer-same-value", role: "over-discrimination" },
  { pathologyId: "numeric-exponent-form", role: "over-discrimination" }
] as const;

/** Spawn failures that are properties of the machine at this instant. Same set as E1/E11. */
const TRANSIENT_SPAWN_CODES = new Set(["ETIMEDOUT", "EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ENOMEM"]);

interface ProcResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a subprocess, returning its exit status and streams rather than throwing on a
 * non-zero exit — because for jq `-e` and `cue vet` a non-zero exit IS the decision
 * (deny), not a failure. Retries once on a transient spawn failure, like E1's arms.
 */
function runProc(file: string, args: string[], input: string): ProcResult {
  const attempt = (): ProcResult => {
    try {
      const stdout = execFileSync(file, args, { input, encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const err = error as { status?: number | null; stdout?: string; stderr?: string; code?: string };
      if (typeof err.code === "string" && TRANSIENT_SPAWN_CODES.has(err.code)) {
        throw error; // signal the outer retry
      }
      // A non-zero exit with captured streams is a normal decision channel here.
      if (typeof err.status === "number") {
        return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
      }
      // No status at all: the binary could not be executed. Surface it.
      return { status: -1, stdout: err.stdout ?? "", stderr: err.stderr ?? (error instanceof Error ? error.message : String(error)) };
    }
  };
  try {
    return attempt();
  } catch {
    return attempt();
  }
}

function probe(command: string, args: string[]): { available: boolean; detail: string } {
  try {
    const out = execFileSync(command, args, { encoding: "utf8", timeout: 10_000 });
    return { available: true, detail: out.trim().split("\n").find((line) => line.trim().length > 0) ?? command };
  } catch (error) {
    return { available: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Render a JS number as a plain decimal literal that is valid, and denotes the same
 * value, in Rego, CUE, jq, and Python. Refuses exponent notation rather than inject a
 * constant whose meaning could differ across engines — a refusal, not a guess.
 */
export function toPlainDecimalLiteral(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`ghost_ark.e16: non-finite value ${value} cannot be a policy constant`);
  }
  const rendered = String(value);
  if (!/^-?\d+(?:\.\d+)?$/u.test(rendered)) {
    throw new Error(
      `ghost_ark.e16: value ${rendered} is not a plain decimal literal (exponent or NaN); refusing to inject an ` +
        "engine-ambiguous constant rather than silently emit one whose meaning could vary across Rego/CUE/jq/Python."
    );
  }
  return rendered;
}

/** A deployed, named decision engine and how it decides `field == R`. */
export interface ConsumerModel {
  id: string;
  name: string;
  /** What it is and why it counts as a deployed, named consumer — not something this repo wrote. */
  deployment: string;
  /** The KIND of decision, so the report never overstates an echo as an authorization. */
  decisionKind: string;
  available: boolean;
  versionDetail: string;
  /** Human-readable command shape, recorded in the artifact so a finding has a pinned command. */
  commandTemplate: string;
  /**
   * Disclosed overlap: jq and CPython also appear elsewhere in this repo as E11/E1
   * canonicalizer arms, so they are not independent of the rest of the project. OPA
   * and CUE are used nowhere else. Recorded rather than hidden.
   */
  independentOfRepo: boolean;
  decide: (rawJson: string, field: string, literal: string, tmpDir: string) => { decision: Decision; raw: string };
}

/** Turn a captured stdout/stderr into a Decision for a boolean-valued engine. */
function decisionFromBoolean(result: ProcResult, trueToken: string, falseToken: string): { decision: Decision; raw: string } {
  const out = result.stdout.trim();
  if (result.status < 0) {
    return { decision: "error", raw: result.stderr.trim() || "engine could not be executed" };
  }
  if (out === trueToken) {
    return { decision: "accept", raw: out };
  }
  if (out === falseToken) {
    return { decision: "deny", raw: out };
  }
  return { decision: "error", raw: `unexpected output ${JSON.stringify(out)} / stderr ${JSON.stringify(result.stderr.trim())}` };
}

let tmpCounter = 0;
function writeTmp(tmpDir: string, name: string, contents: string): string {
  // Date.now()/Math.random() are unavailable in some harness contexts and would break
  // resume; a monotonic counter keeps filenames unique within a run without them.
  const path = join(tmpDir, `${(tmpCounter += 1)}-${name}`);
  writeFileSync(path, contents);
  return path;
}

export function buildConsumerModels(): ConsumerModel[] {
  const opa = probe("opa", ["version"]);
  const cue = probe("cue", ["version"]);
  const jq = probe("jq", ["--version"]);
  const py = probe("python3", ["--version"]);

  // OPA prints a multi-line `version` block; pull the numbered line.
  const opaVersion = opa.available ? opa.detail.replace(/^Version:\s*/u, "OPA ") : opa.detail;

  return [
    {
      id: "opa-rego",
      name: "Open Policy Agent (Rego)",
      deployment: "CNCF-graduated policy engine; the reference authorization decision point for Kubernetes admission, API gateways, and CI policy",
      decisionKind: "authorization allow/deny (default deny; allow if field == R)",
      available: opa.available,
      versionDetail: opaVersion,
      commandTemplate: "opa eval -f raw -d policy.rego -I 'data.ghostark.e16.allow'  (document on stdin)",
      independentOfRepo: true,
      decide: (rawJson, field, literal, tmpDir) => {
        const policy = [
          "package ghostark.e16",
          "",
          "default allow := false",
          "",
          `allow if input[${JSON.stringify(field)}] == ${literal}`,
          ""
        ].join("\n");
        const policyPath = writeTmp(tmpDir, "policy.rego", policy);
        const result = runProc("opa", ["eval", "-f", "raw", "-d", policyPath, "-I", "data.ghostark.e16.allow"], rawJson);
        return decisionFromBoolean(result, "true", "false");
      }
    },
    {
      id: "cue",
      name: "CUE (cuelang.org)",
      deployment: "Configuration and schema-validation language deployed for Kubernetes config validation, data pipelines, and policy-as-config",
      decisionKind: "schema conformance (cue vet against `field: R`; conform=accept, unification conflict=deny)",
      available: cue.available,
      versionDetail: cue.available ? cue.detail : cue.detail,
      commandTemplate: "cue vet schema.cue document.json   (schema is `field: R`)",
      independentOfRepo: true,
      decide: (rawJson, field, literal, tmpDir) => {
        const schema = `${JSON.stringify(field)}: ${literal}\n`;
        const schemaPath = writeTmp(tmpDir, "schema.cue", schema);
        const dataPath = writeTmp(tmpDir, "document.json", rawJson);
        const result = runProc("cue", ["vet", schemaPath, dataPath], "");
        if (result.status === 0) {
          return { decision: "accept", raw: "conform" };
        }
        if (result.status < 0) {
          return { decision: "error", raw: result.stderr.trim() || "cue could not be executed" };
        }
        // A conflict is CUE's deny. Anything else non-zero (usage, IO) is a genuine error.
        if (/conflicting values/u.test(result.stderr)) {
          return { decision: "deny", raw: result.stderr.trim().split("\n")[0] ?? "conflict" };
        }
        return { decision: "error", raw: result.stderr.trim() || `cue exit ${result.status}` };
      }
    },
    {
      id: "jq",
      name: "jq",
      deployment: "Ubiquitous JSON processor used as a decision gate in shell pipelines and CI (`jq -e` sets the exit code from the predicate)",
      decisionKind: "pipeline gate (jq -e 'field == R'; exit 0=accept, exit 1=deny)",
      available: jq.available,
      versionDetail: jq.detail,
      commandTemplate: "jq -e '.[field] == R'   (exit code is the decision)",
      independentOfRepo: false, // also an E11 canonicalizer arm — disclosed
      decide: (rawJson, field, literal) => {
        const filter = `.[${JSON.stringify(field)}] == ${literal}`;
        const result = runProc("jq", ["-e", filter], rawJson);
        if (result.status === 0) {
          return { decision: "accept", raw: result.stdout.trim() };
        }
        if (result.status === 1) {
          return { decision: "deny", raw: result.stdout.trim() || "false" };
        }
        return { decision: "error", raw: result.stderr.trim() || `jq exit ${result.status}` };
      }
    },
    {
      id: "cpython",
      name: "CPython json",
      deployment: "The Python standard-library JSON decoder — the consumer behind a large fraction of deployed services and data tooling",
      decisionKind: "predicate decision (json.load then field == R)",
      available: py.available,
      versionDetail: py.detail,
      commandTemplate: "python3 -c 'json.load(stdin)[field] == R'  ->  accept|deny",
      independentOfRepo: false, // also E1's python-json-sorted arm and E11's cpython-json arm — disclosed
      decide: (rawJson, field, literal) => {
        const program = [
          "import json,sys",
          "d=json.load(sys.stdin)",
          `v=d[${JSON.stringify(field)}]`,
          `print("accept" if v==${literal} else "deny")`
        ].join("\n");
        const result = runProc("python3", ["-c", program], rawJson);
        return decisionFromBoolean(result, "accept", "deny");
      }
    }
  ];
}

/** One (pair, consumer) measurement. */
export interface E16Cell {
  pathologyId: string;
  role: PathologyRole;
  intent: ConsumerIntent;
  consumerId: string;
  field: string;
  /** The value the receipt commits to; both documents share it (that is the collapse). */
  canonicalLiteral: string;
  /** Measured in-process: sha256(canonicalize(parse(rawA))) === sha256(canonicalize(parse(rawB))). */
  ghostArkCollapses: boolean;
  decisionA: Decision;
  decisionB: Decision;
  decisionRawA: string;
  decisionRawB: string;
  distinguishes: boolean;
  /** Collapsed by the receipt AND split by the consumer AND the split matters (intent=distinct). */
  consequentialSplit: boolean;
}

export interface E16ConsumerSummary {
  consumerId: string;
  name: string;
  available: boolean;
  versionDetail: string;
  decisionKind: string;
  independentOfRepo: boolean;
  /** Finding pairs (intent=distinct) this consumer splits on a receipt-collapsed pair. */
  consequentialSplits: string[];
  /** Equivalent-intent pairs this consumer splits (over-discrimination relative to Ghost-Ark). */
  overDiscriminations: string[];
  /** Agrees on the discriminator pair(s), proving its decision procedure can output agreement. */
  discriminatorHolds: boolean;
}

/** One pair under test, with the receipt identity both documents actually share. */
export interface E16PairRecord {
  pathologyId: string;
  role: PathologyRole;
  intent: ConsumerIntent;
  rawA: string;
  rawB: string;
  field: string;
  canonicalLiteral: string;
  /** sha256(canonicalize(parse(raw))) — IDENTICAL for A and B; that identity is the collapse. */
  sharedReceiptDigest: string;
}

export interface E16Report {
  schema_version: typeof E16_REPORT_SCHEMA_VERSION;
  sample_provenance: "census";
  host: string;
  pairs_tested: number;
  ghost_ark_canonicalizer: string;
  pairs: E16PairRecord[];
  consumers: E16ConsumerSummary[];
  cells: E16Cell[];
  /** The headline: cells that are one receipt identity with two consumer decisions. */
  consequential_splits: { pathologyId: string; consumerId: string; decisionA: Decision; decisionB: Decision }[];
  /** Consumers with at least one consequential split — the closure of the open gap. */
  distinguishing_consumers: string[];
  /** Equivalent-intent splits (finer consumer model than Ghost-Ark's declared equivalence). */
  over_discriminations: { pathologyId: string; consumerId: string }[];
  /** Every available consumer agreed on every discriminator pair. */
  discriminator_holds: boolean;
  excluded_consumers: { consumerId: string; reason: string }[];
  degraded: boolean;
  non_claim: string;
}

const NON_CLAIM =
  "E16 demonstrates that specific deployed, version-pinned consumers (OPA, CUE, jq, CPython) CAN reach two different " +
  "decisions on two documents the Ghost-Ark receipt canonicalizer maps to one identity. It is an existence result about " +
  "what is POSSIBLE with a real consumer, not a statement about how often this occurs in production — E12 measured that " +
  "separately and found 0 of 64. It is not a security review of any engine; each behaves exactly as documented. A flip " +
  "means only that the engine's number model is finer than the receipt's canonical form, which is a property of the " +
  "receipt, not a defect in the engine.";

function ghostArkDigest(rawJson: string): string {
  const parsed: unknown = JSON.parse(rawJson);
  return createHash("sha256").update(receiptSchemaCanonicalize(parsed), "utf8").digest("hex");
}

function singleTopLevelField(rawJson: string): { field: string; canonicalValue: number } {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  if (keys.length !== 1) {
    throw new Error(`ghost_ark.e16: expected a single top-level field, got [${keys.join(", ")}] in ${rawJson}`);
  }
  const field = keys[0] as string;
  const value = parsed[field];
  if (typeof value !== "number") {
    throw new Error(`ghost_ark.e16: field ${JSON.stringify(field)} is ${typeof value}, not a number; the == R policy needs a scalar number`);
  }
  return { field, canonicalValue: value };
}

export interface E16Options {
  /** Permit a run with consumers missing. See the refuse-don't-degrade note at the top. */
  allowDegradedConsumers?: boolean;
  /** Test seam: substitute the consumer list (so the refusal branch is testable without spawning). */
  consumers?: ConsumerModel[];
  /** Test seam: substitute the pair list. */
  pairs?: readonly E16PairSpec[];
  /** Host string for the report; defaults to a neutral placeholder (Date/os calls are avoided for resume-safety). */
  host?: string;
}

function resolvePair(spec: E16PairSpec): { spec: E16PairSpec; pathology: PathologyClass } {
  const pathology = PATHOLOGY_ALPHABET.find((entry) => entry.id === spec.pathologyId);
  if (!pathology) {
    throw new Error(`ghost_ark.e16: pathology ${spec.pathologyId} is not in PATHOLOGY_ALPHABET`);
  }
  return { spec, pathology };
}

export function runE16(options: E16Options = {}): E16Report {
  const pairs = options.pairs ?? E16_PAIRS;
  const declared = options.consumers ?? buildConsumerModels();
  const excluded = declared.filter((c) => !c.available).map((c) => ({ consumerId: c.id, reason: c.versionDetail }));
  const consumers = declared.filter((c) => c.available);

  if (consumers.length === 0) {
    throw new Error(
      "ghost_ark.e16: no decision engine is available (need at least one of opa, cue, jq, python3). Refusing to emit: an " +
        "existence experiment with zero consumers measures nothing."
    );
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "ghost-ark-e16-"));
  const cells: E16Cell[] = [];
  const pairRecords: E16PairRecord[] = [];
  try {
    for (const raw of pairs) {
      const { spec, pathology } = resolvePair(raw);
      const { field, canonicalValue } = singleTopLevelField(pathology.rawA);
      // Both sides must resolve to the same canonical value under V8, and Ghost-Ark
      // must actually collapse them — otherwise the premise "the receipt cannot tell
      // them apart" is false and this pair does not belong in E16.
      const bSide = singleTopLevelField(pathology.rawB);
      const digestA = ghostArkDigest(pathology.rawA);
      const ghostArkCollapses = digestA === ghostArkDigest(pathology.rawB);
      if (!ghostArkCollapses) {
        throw new Error(
          `ghost_ark.e16: pathology ${pathology.id} is NOT collapsed by the Ghost-Ark canonicalizer; it cannot be an ` +
            "E16 pair. Remove it or fix the premise."
        );
      }
      const literal = toPlainDecimalLiteral(canonicalValue);
      // Sanity: the receipt's committed value must round-trip to the injected literal.
      if (JSON.parse(`{"x":${literal}}`).x !== canonicalValue || bSide.field !== field) {
        throw new Error(`ghost_ark.e16: canonical literal ${literal} does not round-trip for ${pathology.id}`);
      }
      pairRecords.push({
        pathologyId: pathology.id,
        role: spec.role,
        intent: pathology.intent,
        rawA: pathology.rawA,
        rawB: pathology.rawB,
        field,
        canonicalLiteral: literal,
        sharedReceiptDigest: digestA
      });

      for (const consumer of consumers) {
        const a = consumer.decide(pathology.rawA, field, literal, tmpDir);
        const b = consumer.decide(pathology.rawB, field, literal, tmpDir);
        const distinguishes = a.decision !== b.decision;
        cells.push({
          pathologyId: pathology.id,
          role: spec.role,
          intent: pathology.intent,
          consumerId: consumer.id,
          field,
          canonicalLiteral: literal,
          ghostArkCollapses,
          decisionA: a.decision,
          decisionB: b.decision,
          decisionRawA: a.raw,
          decisionRawB: b.raw,
          distinguishes,
          consequentialSplit: distinguishes && pathology.intent === "distinct"
        });
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Discriminator: every available consumer must AGREE on every discriminator pair.
  // A flip there means the harness is reading wire bytes, not decisions.
  const discriminatorCells = cells.filter((cell) => cell.role === "discriminator");
  const discriminatorPerConsumer = new Map<string, boolean>();
  for (const consumer of consumers) {
    const holds = discriminatorCells
      .filter((cell) => cell.consumerId === consumer.id)
      .every((cell) => !cell.distinguishes && cell.decisionA === "accept");
    discriminatorPerConsumer.set(consumer.id, holds);
  }
  const discriminatorHolds = [...discriminatorPerConsumer.values()].every(Boolean) && discriminatorCells.length > 0;

  const summaries: E16ConsumerSummary[] = consumers.map((consumer) => {
    const own = cells.filter((cell) => cell.consumerId === consumer.id);
    return {
      consumerId: consumer.id,
      name: consumer.name,
      available: true,
      versionDetail: consumer.versionDetail,
      decisionKind: consumer.decisionKind,
      independentOfRepo: consumer.independentOfRepo,
      consequentialSplits: own.filter((cell) => cell.consequentialSplit).map((cell) => cell.pathologyId),
      overDiscriminations: own.filter((cell) => cell.role === "over-discrimination" && cell.distinguishes).map((cell) => cell.pathologyId),
      discriminatorHolds: discriminatorPerConsumer.get(consumer.id) ?? false
    };
  });

  const consequential = cells
    .filter((cell) => cell.consequentialSplit)
    .map((cell) => ({ pathologyId: cell.pathologyId, consumerId: cell.consumerId, decisionA: cell.decisionA, decisionB: cell.decisionB }));

  const distinguishingConsumers = [...new Set(consequential.map((entry) => entry.consumerId))];

  // Refuse-don't-degrade, with the existence/universal asymmetry. A NULL result is only
  // sound if every declared consumer ran; a POSITIVE result is monotone and stands.
  if (distinguishingConsumers.length === 0 && excluded.length > 0 && options.allowDegradedConsumers !== true) {
    throw new Error(
      `ghost_ark.e16: no consumer distinguished any pair, but ${excluded.length} consumer(s) were unavailable ` +
        `(${excluded.map((e) => e.consumerId).join(", ")}). Refusing to emit a NULL result: "no consumer distinguishes" ` +
        "cannot be concluded while a declared consumer is missing — a silently-dropped engine changes the answer, not " +
        "its width. Install the missing engine, or pass { allowDegradedConsumers: true } for an explicitly degraded run. " +
        `Detail: ${excluded.map((e) => `${e.consumerId}: ${e.reason}`).join(" | ")}`
    );
  }

  return {
    schema_version: E16_REPORT_SCHEMA_VERSION,
    sample_provenance: "census",
    host: options.host ?? "unrecorded-host",
    pairs_tested: pairs.length,
    ghost_ark_canonicalizer: "packages/receipt-schema/src/hashCanonicalization.ts canonicalize (V8 JSON.parse)",
    pairs: pairRecords,
    consumers: summaries,
    cells,
    consequential_splits: consequential,
    distinguishing_consumers: distinguishingConsumers,
    over_discriminations: cells
      .filter((cell) => cell.role === "over-discrimination" && cell.distinguishes)
      .map((cell) => ({ pathologyId: cell.pathologyId, consumerId: cell.consumerId })),
    discriminator_holds: discriminatorHolds,
    excluded_consumers: excluded,
    degraded: excluded.length > 0,
    non_claim: NON_CLAIM
  };
}

/** CLI: `npm run experiment:e16 [-- --json] [-- --allow-degraded]` */
function main(): void {
  const host = process.env.GHOST_ARK_HOST ?? "unrecorded-host";
  const report = runE16({ allowDegradedConsumers: process.argv.includes("--allow-degraded"), host });

  // Persist the artifact (artifacts/ is gitignored, like E12's Rekor artifact).
  const outDir = resolve(__dirname, "../../artifacts");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "e16-consumer-distinguishability.json"), `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines: string[] = [];
  lines.push(`E16 consumer distinguishability (${report.schema_version})`);
  lines.push(`host: ${report.host} | pairs: ${report.pairs_tested} | provenance: census (no confidence intervals)`);
  lines.push(`ghost-ark canonicalizer under test: ${report.ghost_ark_canonicalizer}`);
  if (report.degraded) {
    lines.push("");
    lines.push("*** DEGRADED — some consumers unavailable ***");
    for (const e of report.excluded_consumers) {
      lines.push(`  excluded: ${e.consumerId} — ${e.reason}`);
    }
  }
  lines.push("");
  lines.push("consumer     available  discriminator  consequential-splits (intent=distinct)");
  for (const c of report.consumers) {
    lines.push(
      `${c.consumerId.padEnd(12)} ${String(c.available).padEnd(10)} ${(c.discriminatorHolds ? "holds" : "FLIPPED").padEnd(14)} ` +
        `${c.consequentialSplits.join(", ") || "(none)"}`
    );
  }
  lines.push("");
  lines.push("Per-cell decisions (A = side A, B = side B; receipt digest is EQUAL for A and B):");
  lines.push("pathology                       role                consumer    A       B       distinguishes");
  for (const cell of report.cells) {
    lines.push(
      `${cell.pathologyId.padEnd(31)} ${cell.role.padEnd(19)} ${cell.consumerId.padEnd(11)} ` +
        `${cell.decisionA.padEnd(7)} ${cell.decisionB.padEnd(7)} ${cell.distinguishes ? "YES" : "no"}`
    );
  }
  lines.push("");
  lines.push(`DISCRIMINATOR (every consumer must agree on the equivalent pair): ${report.discriminator_holds ? "HOLDS" : "*** FLIPPED — run void ***"}`);
  lines.push("");
  lines.push(`ONE RECEIPT IDENTITY, TWO CONSUMER OUTCOMES: ${report.consequential_splits.length} cell(s)`);
  for (const s of report.consequential_splits) {
    lines.push(`  - ${s.pathologyId}: ${s.consumerId} decides A=${s.decisionA}, B=${s.decisionB}`);
  }
  lines.push("");
  lines.push(`distinguishing consumers (closes the open gap): ${report.distinguishing_consumers.join(", ") || "(NONE — null result)"}`);
  if (report.over_discriminations.length > 0) {
    lines.push("");
    lines.push("over-discrimination (consumer model finer than Ghost-Ark's declared equivalence):");
    for (const o of report.over_discriminations) {
      lines.push(`  - ${o.pathologyId}: ${o.consumerId}`);
    }
  }
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) {
  main();
}
