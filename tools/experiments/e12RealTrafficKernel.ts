/**
 * E12 — Real-traffic kernel incidence (Arm E of the Observability Gap program).
 *
 * THE GAP THIS EXISTS TO CLOSE
 * ----------------------------
 * Every incidence figure this project has reported comes from a hand-curated
 * alphabet or a declared generator. Falsifier F2 in `00_THESIS.md` says the
 * finding may therefore be an artifact of what the author chose to look at.
 * The only answer to that is a corpus this project did not author.
 *
 * E12 draws a uniform random sample from Sigstore's public Rekor transparency
 * log and asks, of each real production attestation payload: does it contain a
 * construct that a declared consumer would distinguish but a canonicalization
 * step does not?
 *
 * WHAT THIS IS NOT MEASURING, STATED FIRST BECAUSE IT IS THE OBVIOUS OBJECTION
 * ---------------------------------------------------------------------------
 * This is NOT a canonicalization weakness in Sigstore, and it is important to
 * say so before reporting any number. DSSE signs the raw payload octets under
 * PAE, and Rekor records `payloadHash` over those same octets. There is no
 * canonicalization step anywhere in that verification path, so the layering gap
 * this program studies structurally cannot bite there. Sigstore is, on this
 * specific question, an example of the safe design.
 *
 * The entries are used as a CORPUS, not as a target: they are a large body of
 * real JSON emitted by real build systems, which is the thing F2 says this
 * project has never measured against. The hazard a finding describes belongs to
 * a DOWNSTREAM consumer that parses and re-serializes such a payload — a policy
 * engine, an indexer, a mirror, a re-signer — not to the log.
 *
 * The word "signed" is also deliberately absent from what is claimed. Rekor's
 * intoto entry stores hashes of the envelope and the payload; it does not store
 * the DSSE envelope, so no signature can be checked from log data alone. What
 * IS checked, per entry, is that the payload bytes scanned hash to the
 * `payloadHash` the log recorded.
 *
 * WHY THIS IS THE FIRST MEASUREMENT HERE THAT EARNS A CONFIDENCE INTERVAL
 * ----------------------------------------------------------------------
 * The draws are uniform over a population this project did not construct and
 * cannot influence, so `reportProportion` with provenance `sampled` applies
 * rather than `census`. Every other experiment in this repository reports exact
 * counts because its corpus was an authoring decision. This one is not.
 *
 * That licence is narrower than it looks, and the report says so in the same
 * place it reports the number. Entries are NOT independent draws from "the
 * population of attestations": a handful of toolchains emit most of them and one
 * CI run emits many. An entry-level interval therefore understates uncertainty.
 * The report carries a PRODUCER-CLUSTERED proportion beside the entry-level one,
 * and a reader is directed to the clustered figure.
 *
 * THE HARNESS MUST NOT PARSE THE PAYLOAD
 * -------------------------------------
 * Base64-decoding an attestation and re-parsing it is exactly the
 * `parse . canonicalize` composition under study. Every construct being counted
 * is one that `JSON.parse` destroys, so a harness that parses would report zero
 * and the zero would be a property of the instrument. Payload bytes go to
 * `scanRawJson`, which walks UTF-8 bytes with its own tokenizer.
 *
 * The Rekor RESPONSE is parsed, and that is sound: the payload arrives as a
 * base64 string, and base64 decoding recovers the producer's exact bytes no
 * matter how the surrounding envelope was parsed. The transport is parsed; the
 * measurement target never is.
 *
 * WHAT A FINDING IS NOT
 * ---------------------
 * A finding is not an allegation against whoever produced the entry. These are
 * ordinary artifacts emitted by ordinary build tooling. The measurement is of
 * the JSON identity problem, not of any producer's competence, and nothing here
 * is a security review of Sigstore, Rekor, or any project whose entries are
 * drawn.
 *
 * NON-CLAIM: E12 measures the incidence of syntactic constructs in a random
 * sample of one public transparency log. It is not a statement that any entry,
 * producer, or verifier is defective; not evidence that any of these constructs
 * was ever exploited; and not evidence about semantic safety, compliance, model
 * behaviour, or the correctness of any deployment. A construct being present
 * says nothing about whether any consumer of that entry distinguishes it.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { reportProportion, type ProportionReport } from "../../packages/research-frontier/src/stats/descriptive";
import { wilsonInterval } from "../../packages/research-frontier/src/oracle/mEstimator";
import { scanRawJson, RAW_FINDING_CLASSES, type RawFindingClass, type RawJsonScanResult } from "./rawJsonScan";

export const E12_REPORT_SCHEMA_VERSION = "ghost.e12_real_traffic_kernel.v1";

/** Identifies this client to the operators of free public infrastructure. */
export const USER_AGENT =
  "ghost-ark-observability-gap-research/0.1 (+https://github.com/pranavbhave/ghost-ark; research measurement, low rate)";

const REKOR_BASE = "https://rekor.sigstore.dev";
const DEFAULT_SEED = 20260812;
const DEFAULT_DRAWS = 1500;
const DEFAULT_DELAY_MS = 300;

/* -------------------------------------------------------------------------- */
/* Sampling frame                                                             */
/* -------------------------------------------------------------------------- */

export interface ShardDescriptor {
  treeID: string;
  treeSize: number;
  active: boolean;
}

export interface SamplingFrame {
  /**
   * The total number of addressable global log indices.
   *
   * CORRECTION, recorded because the program document got this wrong: the
   * `treeSize` at `GET /api/v1/log` is the size of the ACTIVE SHARD ONLY. Rekor
   * addresses entries by a GLOBAL index that spans every shard, so the frame is
   * the SUM over all shards. Drawing uniformly over the active shard's treeSize
   * would cover both retired shards in full and truncate the newest entries of
   * the active one, which is a biased frame that would look uniform.
   */
  totalIndices: number;
  shards: ShardDescriptor[];
  /** ISO date the frame was read. The log only grows, so a frame is dated. */
  observedAt: string;
  /** True when totalIndices was pinned by the caller rather than read live. */
  frozenTotal?: boolean;
  /** What the live API reported at run time, when the total was pinned. */
  observedTotalAtRun?: number;
}

export function computeFrame(logInfo: RekorLogInfo, observedAt: string): SamplingFrame {
  const shards: ShardDescriptor[] = [
    ...(logInfo.inactiveShards ?? []).map((shard) => ({
      treeID: shard.treeID,
      treeSize: shard.treeSize,
      active: false
    })),
    { treeID: logInfo.treeID, treeSize: logInfo.treeSize, active: true }
  ];
  const totalIndices = shards.reduce((sum, shard) => sum + shard.treeSize, 0);
  return { totalIndices, shards, observedAt };
}

export interface RekorLogInfo {
  treeID: string;
  treeSize: number;
  inactiveShards?: { treeID: string; treeSize: number }[];
}

/* -------------------------------------------------------------------------- */
/* Reproducible uniform sampling                                              */
/* -------------------------------------------------------------------------- */

/** mulberry32, matching E1-B, so a run replays exactly from its seed. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An exactly uniform integer in [0, bound), by rejection sampling over 53 bits.
 *
 * `Math.floor(rng() * bound)` is NOT used, and the difference is not academic
 * at this scale: one mulberry32 output carries 32 bits, so mapping it onto
 * 2.4e9 buckets gives some buckets two source values and others one — a bias of
 * up to about 76% between adjacent buckets in a sample whose entire claim to an
 * interval rests on the draws being uniform.
 */
export function uniformBelow(rng: () => number, bound: number): number {
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw new Error("ghost_ark.e12: uniformBelow requires a positive safe-integer bound.");
  }
  const space = 2 ** 53;
  const limit = Math.floor(space / bound) * bound;
  for (;;) {
    const high = Math.floor(rng() * 2 ** 26);
    const low = Math.floor(rng() * 2 ** 27);
    const draw = high * 2 ** 27 + low;
    if (draw < limit) {
      return draw % bound;
    }
  }
}

export function drawIndices(seed: number, count: number, frame: SamplingFrame): number[] {
  const rng = makeRng(seed);
  const indices: number[] = [];
  for (let drawn = 0; drawn < count; drawn += 1) {
    indices.push(uniformBelow(rng, frame.totalIndices));
  }
  return indices;
}

/* -------------------------------------------------------------------------- */
/* Entry model                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Why a drawn entry did or did not supply payload bytes to measure.
 *
 * `absent-by-type` is the load-bearing one and it corrects the program
 * document's pilot. A Rekor `dsse` entry stores `envelopeHash`, `payloadHash`
 * and signatures — it does NOT store the payload. Neither does `rekord` or
 * `hashedrekord`. The pilot read "16 dsse" as "16 JSON attestation payloads";
 * they are 16 hashes. Only `intoto` v0.0.1 carries a retrievable attestation.
 */
export type EligibilityStatus =
  /** Payload bytes were retrieved, digest-verified against the log, and scanned. */
  | "eligible"
  /** This entry kind stores hashes only; there is no payload in the log. */
  | "absent-by-type"
  /** The kind can carry an attestation but this entry has none (size limit, or not stored). */
  | "absent-though-typed"
  /**
   * Payload bytes were retrieved but did NOT hash to the `payloadHash` the log
   * recorded. Its own stratum rather than a silent drop: a mismatch means the
   * transport altered the bytes, which would invalidate every finding taken
   * from them.
   */
  | "payload-digest-mismatch"
  /** The draw could not be resolved. Never silently dropped. */
  | "unresolved";

export interface DrawRecord {
  logIndex: number;
  kind: string | null;
  apiVersion: string | null;
  eligibility: EligibilityStatus;
  detail: string | null;
  payloadBytes: number | null;
  /** sha256 of the raw payload bytes, for de-duplication across indices. */
  payloadDigest: string | null;
  /**
   * Stratification key for the clustering adjustment. Derived from the payload
   * by a BOUNDED pattern match used ONLY to group entries; no finding is ever
   * taken from it, and its imprecision affects grouping, not measurement.
   */
  producerKey: string | null;
  scan: RawJsonScanResult | null;
}

/** Base64 that round-trips. Node's decoder silently ignores stray characters. */
function decodeStrictBase64(text: string): Buffer | null {
  const bytes = Buffer.from(text, "base64");
  return bytes.toString("base64") === text.replace(/[\r\n]/gu, "") ? bytes : null;
}

/**
 * Groups entries by the toolchain that produced them.
 *
 * Matched against the raw bytes with a bounded pattern rather than by parsing,
 * to keep the no-parse discipline total. Used only to compute how concentrated
 * the sample is; a miss degrades the clustering estimate and cannot create or
 * suppress a finding.
 */
export function producerKeyOf(payload: Uint8Array): string {
  const head = Buffer.from(payload.subarray(0, 4096)).toString("latin1");
  const predicateType = /"predicateType"\s*:\s*"([^"]{0,120})"/u.exec(head)?.[1];
  const buildType =
    /"buildType"\s*:\s*"([^"]{0,120})"/u.exec(head)?.[1] ?? /"builder"\s*:\s*\{\s*"id"\s*:\s*"([^"]{0,120})"/u.exec(head)?.[1];
  if (predicateType === undefined && buildType === undefined) {
    return "(unattributed)";
  }
  return `${predicateType ?? "?"}|${buildType ?? "?"}`;
}

/** Decodes the Rekor entry envelope. Touches the transport, never the payload. */
export function classifyEntry(logIndex: number, responseBody: string): DrawRecord {
  const blank = {
    logIndex,
    kind: null,
    apiVersion: null,
    payloadBytes: null,
    payloadDigest: null,
    producerKey: null,
    scan: null
  };

  const parsed = JSON.parse(responseBody) as Record<string, unknown>;
  const uuid = Object.keys(parsed)[0];
  if (uuid === undefined) {
    return { ...blank, eligibility: "unresolved", detail: "response contained no entry" };
  }
  const entry = parsed[uuid] as { body?: string; logIndex?: number; attestation?: { data?: string } };

  // Silent-corruption guard. `verification.inclusionProof.logIndex` is
  // SHARD-LOCAL while the query parameter is global, so reading the wrong field
  // would shift every shard-2 sample by 4,163,431 and every shard-3 sample by
  // 121,904,262 without any error surfacing.
  if (typeof entry.logIndex === "number" && entry.logIndex !== logIndex) {
    return {
      ...blank,
      eligibility: "unresolved",
      detail: `server returned logIndex ${entry.logIndex} for a request for ${logIndex}`
    };
  }

  let kind: string | null = null;
  let apiVersion: string | null = null;
  let declaredPayloadHash: string | null = null;
  if (typeof entry.body === "string") {
    try {
      const body = JSON.parse(Buffer.from(entry.body, "base64").toString("utf8")) as {
        kind?: string;
        apiVersion?: string;
        spec?: { content?: { payloadHash?: { algorithm?: string; value?: string } } };
      };
      kind = body.kind ?? null;
      apiVersion = body.apiVersion ?? null;
      const declared = body.spec?.content?.payloadHash;
      if (declared?.algorithm === "sha256" && typeof declared.value === "string") {
        declaredPayloadHash = declared.value;
      }
    } catch {
      kind = null;
    }
  }

  const attestationData = entry.attestation?.data;
  if (typeof attestationData === "string" && attestationData.length > 0) {
    const decoded = decodeStrictBase64(attestationData);
    if (decoded === null) {
      return {
        ...blank,
        kind,
        apiVersion,
        eligibility: "payload-digest-mismatch",
        detail: "attestation data is not canonical base64"
      };
    }
    const payload = new Uint8Array(decoded);
    const digest = createHash("sha256").update(decoded).digest("hex");

    // The check that makes "these are the producer's bytes" a verified fact
    // rather than a methodological assertion. Without it, the arm's central
    // claim is generalized from however many entries were spot-checked by hand.
    if (declaredPayloadHash !== null && declaredPayloadHash !== digest) {
      return {
        ...blank,
        kind,
        apiVersion,
        payloadBytes: payload.length,
        payloadDigest: digest,
        eligibility: "payload-digest-mismatch",
        detail: `log recorded payloadHash ${declaredPayloadHash}, bytes scanned hash to ${digest}`
      };
    }

    return {
      logIndex,
      kind,
      apiVersion,
      eligibility: "eligible",
      detail: declaredPayloadHash === null ? "no payloadHash recorded to check against" : null,
      payloadBytes: payload.length,
      payloadDigest: digest,
      producerKey: producerKeyOf(payload),
      scan: scanRawJson(payload)
    };
  }

  const hashOnlyKinds = new Set(["hashedrekord", "rekord", "dsse", "rfc3161", "cose", "alpine", "helm", "jar", "rpm", "tuf"]);
  if (kind !== null && hashOnlyKinds.has(kind)) {
    return {
      ...blank,
      kind,
      apiVersion,
      eligibility: "absent-by-type",
      detail: `${kind} entries record hashes and signatures; the payload is not stored in the log`
    };
  }

  return {
    ...blank,
    kind,
    apiVersion,
    eligibility: "absent-though-typed",
    detail: kind === null ? "entry kind could not be read" : `${kind} entry carried no attestation`
  };
}

/* -------------------------------------------------------------------------- */
/* Positive controls — the discriminator for this arm                         */
/* -------------------------------------------------------------------------- */

/**
 * Synthetic payloads carrying each construct, pushed through the SAME
 * base64-decode-and-scan path a live entry takes.
 *
 * This repository does not accept a detection result whose mechanism was never
 * shown to fire; that rule already caught a tautological benchmark and an
 * experiment arm that reported a missing interpreter as a clean result. Arm E
 * needs it more than most, because its headline may well be a zero, and a zero
 * from a working detector and a zero from a broken tokenizer are the same
 * number.
 *
 * A hygiene test asserting `rawJsonScan.ts` contains no `JSON.parse` is
 * necessary and not sufficient: it shows the file does not call a function, not
 * that the tokenizer finds anything.
 */
export interface PositiveControl {
  findingClass: RawFindingClass;
  payload: string;
  detected: boolean;
}

const CONTROL_PAYLOADS: { findingClass: RawFindingClass; payload: string }[] = [
  {
    findingClass: "duplicate-member-name",
    payload: '{"_type":"https://in-toto.io/Statement/v1","subject":[{"name":"a","name":"b"}]}'
  },
  { findingClass: "unsafe-magnitude-integer", payload: '{"predicate":{"bytes":9007199254740993}}' },
  { findingClass: "non-round-tripping-literal", payload: '{"predicate":{"rate":0.1000000000000000055511151231257827}}' },
  { findingClass: "overflow-to-infinity", payload: '{"predicate":{"v":1e400}}' },
  { findingClass: "underflow-to-zero", payload: '{"predicate":{"v":1e-400}}' },
  { findingClass: "lone-surrogate-escape", payload: '{"predicate":{"name":"\\ud800"}}' },
  { findingClass: "non-nfc-string", payload: '{"predicate":{"name":"cafe\\u0301"}}' }
];

/**
 * Runs each control through the live decode path.
 *
 * `decode` is the same function the runner applies to `attestation.data`, so a
 * defect in base64 handling shows up here too rather than only in production.
 */
export function runPositiveControls(
  decode: (base64: string) => Buffer | null = decodeStrictBase64
): PositiveControl[] {
  return CONTROL_PAYLOADS.map(({ findingClass, payload }) => {
    const encoded = Buffer.from(payload, "utf8").toString("base64");
    const decoded = decode(encoded);
    const scan = decoded === null ? null : scanRawJson(new Uint8Array(decoded));
    return { findingClass, payload, detected: (scan?.counts[findingClass] ?? 0) > 0 };
  });
}

/* -------------------------------------------------------------------------- */
/* Clustering                                                                 */
/* -------------------------------------------------------------------------- */

export interface ClusterSummary {
  /** Distinct producer keys among eligible entries. */
  producers: number;
  /** Share of eligible entries contributed by the single largest producer. */
  largestProducerShare: number;
  /** Distinct payload digests; equal to eligible entries only if nothing repeated. */
  distinctPayloads: number;
  /** Eligible entries whose payload bytes were seen at another drawn index. */
  duplicatePayloads: number;
  perProducer: { producerKey: string; entries: number; entriesWithAnyFinding: number }[];
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

export interface E12Report {
  schema_version: typeof E12_REPORT_SCHEMA_VERSION;
  corpus: string;
  seed: number;
  frame: SamplingFrame;
  requestedDraws: number;
  /**
   * True when every draw resolved. A degraded run is reported, never quietly
   * shrunk: an unresolved draw that is dropped turns a network failure into a
   * silent change of denominator, which is the F1.7 defect from E1.
   */
  complete: boolean;
  unresolvedDraws: number;
  eligibilityCounts: Record<EligibilityStatus, number>;
  kindCounts: Record<string, number>;
  /** Denominator 1: every resolved draw, eligible or not. */
  resolvedDraws: number;
  /** Denominator 2: draws that yielded payload bytes. The one that answers the question. */
  eligibleDraws: number;
  /** Entries carrying at least one finding of any class, over eligible draws. */
  anyFinding: ProportionReport;
  /**
   * The same quantity with the clustering collapsed: one observation per
   * distinct producer, counted as affected if ANY of its entries carried a
   * finding. Entries from one toolchain are not independent draws, so the
   * entry-level interval above is optimistic and this is the figure to read.
   */
  anyFindingByProducer: ProportionReport;
  /** Per class, over eligible draws. */
  perClass: Record<RawFindingClass, ProportionReport>;
  clustering: ClusterSummary;
  /** Proof the detector fires, reported beside the result so a zero is readable. */
  positiveControls: PositiveControl[];
  /** True when every declared construct was detected through the live decode path. */
  positiveControlsAllDetected: boolean;
  /** Raw totals across the sample, so a per-entry rate and a per-construct count are not confused. */
  totals: {
    payloadBytes: number;
    members: number;
    strings: number;
    numbers: number;
    inexactNumbers: number;
    largeMagnitudeNumbers: number;
    malformedPayloads: number;
    findingsByClass: Record<RawFindingClass, number>;
  };
  draws: DrawRecord[];
  non_claim: string;
}

const NON_CLAIM =
  "E12 measures the incidence of syntactic constructs in a uniform random sample of one public transparency log. " +
  "It is not a statement that any entry, producer, or verifier is defective, not evidence that any construct was " +
  "ever exploited, and not evidence about semantic safety, compliance, model behaviour, or the correctness of any " +
  "deployment. A construct being present says nothing about whether any consumer of that entry distinguishes it.";

function emptyClassCounts(): Record<RawFindingClass, number> {
  const counts = {} as Record<RawFindingClass, number>;
  for (const key of RAW_FINDING_CLASSES) {
    counts[key] = 0;
  }
  return counts;
}

export function buildReport(options: {
  corpus: string;
  seed: number;
  frame: SamplingFrame;
  requestedDraws: number;
  draws: DrawRecord[];
}): E12Report {
  const { corpus, seed, frame, requestedDraws, draws } = options;

  const eligibilityCounts: Record<EligibilityStatus, number> = {
    eligible: 0,
    "absent-by-type": 0,
    "absent-though-typed": 0,
    "payload-digest-mismatch": 0,
    unresolved: 0
  };
  const kindCounts: Record<string, number> = {};
  const findingsByClass = emptyClassCounts();
  const entriesWithClass = emptyClassCounts();

  let payloadBytes = 0;
  let members = 0;
  let strings = 0;
  let numbers = 0;
  let inexactNumbers = 0;
  let largeMagnitudeNumbers = 0;
  let malformedPayloads = 0;
  let entriesWithAnyFinding = 0;

  for (const draw of draws) {
    eligibilityCounts[draw.eligibility] += 1;
    const kindKey = draw.kind ?? "(unreadable)";
    kindCounts[kindKey] = (kindCounts[kindKey] ?? 0) + 1;

    if (draw.scan === null) {
      continue;
    }
    payloadBytes += draw.scan.byteLength;
    members += draw.scan.memberCount;
    strings += draw.scan.stringCount;
    numbers += draw.scan.numberCount;
    inexactNumbers += draw.scan.inexactNumberCount;
    largeMagnitudeNumbers += draw.scan.largeMagnitudeNumberCount;
    if (!draw.scan.wellFormed) {
      malformedPayloads += 1;
    }

    let any = false;
    for (const findingClass of RAW_FINDING_CLASSES) {
      const count = draw.scan.counts[findingClass];
      findingsByClass[findingClass] += count;
      if (count > 0) {
        entriesWithClass[findingClass] += 1;
        any = true;
      }
    }
    if (any) {
      entriesWithAnyFinding += 1;
    }
  }

  const unresolvedDraws = eligibilityCounts.unresolved;
  const resolvedDraws = draws.length - unresolvedDraws;
  const eligibleDraws = eligibilityCounts.eligible;

  // An interval is only meaningful over a real denominator. At zero eligible
  // draws there is nothing to report a proportion over, and saying so is the
  // correct output.
  const proportion = (successes: number): ProportionReport =>
    eligibleDraws > 0
      ? reportProportion(successes, eligibleDraws, "sampled", wilsonInterval)
      : {
          successes: 0,
          total: 0,
          observed: Number.NaN,
          provenance: "sampled",
          interval: null,
          intervalOmittedBecause: "No eligible draw yielded payload bytes; there is no denominator."
        };

  const perClass = {} as Record<RawFindingClass, ProportionReport>;
  for (const findingClass of RAW_FINDING_CLASSES) {
    perClass[findingClass] = proportion(entriesWithClass[findingClass]);
  }

  const eligible = draws.filter((draw) => draw.eligibility === "eligible");
  const byProducer = new Map<string, { entries: number; entriesWithAnyFinding: number }>();
  const payloadDigests = new Map<string, number>();
  for (const draw of eligible) {
    const key = draw.producerKey ?? "(unattributed)";
    const bucket = byProducer.get(key) ?? { entries: 0, entriesWithAnyFinding: 0 };
    bucket.entries += 1;
    const scan = draw.scan;
    if (scan !== null && RAW_FINDING_CLASSES.some((findingClass) => scan.counts[findingClass] > 0)) {
      bucket.entriesWithAnyFinding += 1;
    }
    byProducer.set(key, bucket);
    if (draw.payloadDigest !== null) {
      payloadDigests.set(draw.payloadDigest, (payloadDigests.get(draw.payloadDigest) ?? 0) + 1);
    }
  }

  const perProducer = [...byProducer.entries()]
    .map(([producerKey, bucket]) => ({ producerKey, ...bucket }))
    .sort((left, right) => right.entries - left.entries);

  const clustering: ClusterSummary = {
    producers: perProducer.length,
    largestProducerShare: eligible.length > 0 ? (perProducer[0]?.entries ?? 0) / eligible.length : Number.NaN,
    distinctPayloads: payloadDigests.size,
    duplicatePayloads: eligible.length - payloadDigests.size,
    perProducer
  };

  const producersAffected = perProducer.filter((entry) => entry.entriesWithAnyFinding > 0).length;
  const anyFindingByProducer: ProportionReport =
    perProducer.length > 0
      ? reportProportion(producersAffected, perProducer.length, "sampled", wilsonInterval)
      : {
          successes: 0,
          total: 0,
          observed: Number.NaN,
          provenance: "sampled",
          interval: null,
          intervalOmittedBecause: "No eligible draw yielded payload bytes; there is no denominator."
        };

  const positiveControls = runPositiveControls();

  return {
    schema_version: E12_REPORT_SCHEMA_VERSION,
    corpus,
    seed,
    frame,
    requestedDraws,
    complete: unresolvedDraws === 0 && draws.length === requestedDraws,
    unresolvedDraws,
    eligibilityCounts,
    kindCounts,
    resolvedDraws,
    eligibleDraws,
    anyFinding: proportion(entriesWithAnyFinding),
    anyFindingByProducer,
    perClass,
    clustering,
    positiveControls,
    positiveControlsAllDetected: positiveControls.every((control) => control.detected),
    totals: {
      payloadBytes,
      members,
      strings,
      numbers,
      inexactNumbers,
      largeMagnitudeNumbers,
      malformedPayloads,
      findingsByClass
    },
    draws,
    non_claim: NON_CLAIM
  };
}

/* -------------------------------------------------------------------------- */
/* Network                                                                    */
/* -------------------------------------------------------------------------- */

export interface FetchOutcome {
  ok: boolean;
  body: string | null;
  detail: string;
}

/**
 * One polite HTTP GET, via curl so the harness inherits no HTTP dependency.
 *
 * Retries only on codes that describe the network at this instant. A definitive
 * refusal is returned as `ok: false` and becomes an `unresolved` draw that the
 * report counts, rather than a dropped draw that silently moves a denominator.
 */
export function fetchUrl(url: string, attempts = 3): FetchOutcome {
  let lastDetail = "no attempt made";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const stdout = execFileSync(
        "curl",
        ["-sS", "--fail", "--max-time", "45", "-A", USER_AGENT, url],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
      );
      return { ok: true, body: stdout, detail: `attempt ${attempt}` };
    } catch (error) {
      const failure = error as { status?: number | null; message?: string };
      lastDetail = `curl exit ${failure.status ?? "?"}: ${(failure.message ?? "").split("\n")[0]}`;
      // curl exit 22 is an HTTP >= 400 under --fail; that is the server's
      // answer and retrying it is impolite, so only transport failures retry.
      if (failure.status === 22) {
        return { ok: false, body: null, detail: lastDetail };
      }
      if (attempt < attempts) {
        sleepSeconds(2 ** attempt);
      }
    }
  }
  return { ok: false, body: null, detail: lastDetail };
}

function sleepSeconds(seconds: number): void {
  execFileSync("sleep", [String(seconds)], { stdio: "ignore" });
}

function sleepMillis(millis: number): void {
  if (millis > 0) {
    execFileSync("sleep", [(millis / 1000).toFixed(3)], { stdio: "ignore" });
  }
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                     */
/* -------------------------------------------------------------------------- */

export interface RunOptions {
  seed?: number;
  draws?: number;
  /**
   * Pin the sampling frame instead of reading it live. Required to replay a
   * recorded run: the log grows, and a different total turns the same seed into
   * a different index sequence.
   */
  frameTotal?: number;
  delayMs?: number;
  cacheDir?: string;
  /** Injected in tests so no test touches the network. */
  fetcher?: (url: string) => FetchOutcome;
  onProgress?: (done: number, total: number, eligible: number) => void;
}

export function runE12(options: RunOptions = {}): E12Report {
  const seed = options.seed ?? DEFAULT_SEED;
  const requestedDraws = options.draws ?? DEFAULT_DRAWS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const fetcher = options.fetcher ?? ((url: string) => fetchUrl(url));
  const cacheDir = options.cacheDir ?? resolve(__dirname, "../../artifacts/e12-rekor-cache");

  mkdirSync(cacheDir, { recursive: true });

  const logInfoOutcome = fetcher(`${REKOR_BASE}/api/v1/log`);
  if (!logInfoOutcome.ok || logInfoOutcome.body === null) {
    throw new Error(`ghost_ark.e12: could not read the sampling frame: ${logInfoOutcome.detail}`);
  }
  const logInfo = JSON.parse(logInfoOutcome.body) as RekorLogInfo;
  const observedAt = new Date().toISOString().slice(0, 10);
  const observed = computeFrame(logInfo, observedAt);

  // The log grows continuously, so the frame is a moving target and a seed alone
  // does not identify a sample: a different total produces a different index
  // sequence from the same seed. Freezing the total is what makes a run
  // replayable by somebody else on a later day.
  const frame: SamplingFrame =
    options.frameTotal === undefined
      ? observed
      : { ...observed, totalIndices: options.frameTotal, frozenTotal: true, observedTotalAtRun: observed.totalIndices };

  const indices = drawIndices(seed, requestedDraws, frame);

  // Pre-registration, written BEFORE the first entry is fetched. Reporting rule
  // 5 in EXPERIMENTS.md requires the design to be fixed before the data is
  // seen; with a network corpus the specific thing that must be fixed is WHICH
  // indices are in the sample, because silently adding draws after seeing
  // results is otherwise undetectable.
  const preregistration = {
    seed,
    requestedDraws,
    frame,
    drawnIndices: indices,
    writtenAtUtc: new Date().toISOString()
  };
  const preregistrationText = `${JSON.stringify(preregistration, null, 2)}\n`;
  const preregistrationPath = resolve(cacheDir, `preregistration-seed${seed}-n${requestedDraws}.json`);
  if (existsSync(preregistrationPath)) {
    const existing = readFileSync(preregistrationPath, "utf8");
    const sameDraws =
      (JSON.parse(existing) as { drawnIndices: number[] }).drawnIndices.join(",") === indices.join(",");
    if (!sameDraws) {
      throw new Error(
        `ghost_ark.e12: a pre-registration exists at ${preregistrationPath} with a DIFFERENT index list. ` +
          "Re-running the same seed and n must draw the same indices; pass --frame-total to pin the frame."
      );
    }
  } else {
    writeFileSync(preregistrationPath, preregistrationText);
  }
  writeFileSync(
    resolve(cacheDir, "frame.json"),
    `${JSON.stringify({ ...frame, preregistrationSha256: createHash("sha256").update(preregistrationText).digest("hex") }, null, 2)}\n`
  );
  const draws: DrawRecord[] = [];
  let eligible = 0;

  for (let position = 0; position < indices.length; position += 1) {
    const logIndex = indices[position] as number;
    const cachePath = resolve(cacheDir, `${logIndex}.json`);

    let body: string | null = null;
    let detail = "cache";
    if (existsSync(cachePath)) {
      body = readFileSync(cachePath, "utf8");
    } else {
      const outcome = fetcher(`${REKOR_BASE}/api/v1/log/entries?logIndex=${logIndex}`);
      detail = outcome.detail;
      if (outcome.ok && outcome.body !== null) {
        body = outcome.body;
        writeFileSync(cachePath, body);
      }
      sleepMillis(delayMs);
    }

    if (body === null) {
      draws.push({
        logIndex,
        kind: null,
        apiVersion: null,
        eligibility: "unresolved",
        detail,
        payloadBytes: null,
        payloadDigest: null,
        producerKey: null,
        scan: null
      });
      continue;
    }

    let record: DrawRecord;
    try {
      record = classifyEntry(logIndex, body);
    } catch (error) {
      record = {
        logIndex,
        kind: null,
        apiVersion: null,
        eligibility: "unresolved",
        detail: `envelope could not be read: ${error instanceof Error ? error.message : String(error)}`,
        payloadBytes: null,
        payloadDigest: null,
        producerKey: null,
        scan: null
      };
    }
    draws.push(record);
    if (record.eligibility === "eligible") {
      eligible += 1;
    }
    options.onProgress?.(position + 1, indices.length, eligible);
  }

  return buildReport({ corpus: "sigstore-rekor", seed, frame, requestedDraws, draws });
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function argNumber(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

export function renderReport(report: E12Report): string {
  const lines: string[] = [];
  const pct = (value: number): string => (Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "n/a");
  const withInterval = (proportion: ProportionReport): string =>
    proportion.interval === null
      ? `${proportion.successes}/${proportion.total} (${pct(proportion.observed)}) — no interval: ${proportion.intervalOmittedBecause}`
      : `${proportion.successes}/${proportion.total} (${pct(proportion.observed)}) 95% CI [${pct(proportion.interval.low)}, ${pct(proportion.interval.high)}]`;

  lines.push(`E12 real-traffic kernel incidence (${report.schema_version})`);
  lines.push(`corpus: ${report.corpus} | seed: ${report.seed} | frame observed ${report.frame.observedAt}`);
  lines.push(`sampling frame: ${report.frame.totalIndices} global log indices across ${report.frame.shards.length} shards`);
  for (const shard of report.frame.shards) {
    lines.push(`  shard ${shard.treeID} size ${shard.treeSize}${shard.active ? " (active)" : ""}`);
  }
  lines.push("");
  lines.push(`draws requested: ${report.requestedDraws} | resolved: ${report.resolvedDraws} | unresolved: ${report.unresolvedDraws}`);
  lines.push(`complete: ${report.complete}`);
  lines.push("");
  lines.push("ENTRY KINDS DRAWN");
  for (const [kind, count] of Object.entries(report.kindCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${kind.padEnd(18)} ${count}`);
  }
  lines.push("");
  lines.push("ELIGIBILITY (both denominators are reported because they answer different questions)");
  for (const [status, count] of Object.entries(report.eligibilityCounts)) {
    lines.push(`  ${status.padEnd(20)} ${count}`);
  }
  lines.push(`  eligible / resolved  = ${report.eligibleDraws}/${report.resolvedDraws}`);
  lines.push("");
  lines.push("POSITIVE CONTROLS — each construct pushed through the same decode-and-scan path a live entry takes.");
  lines.push("  A zero below is only readable because these fire; a broken tokenizer would also report zero.");
  for (const control of report.positiveControls) {
    lines.push(`  ${control.detected ? "DETECTED" : "MISSED  "}  ${control.findingClass}`);
  }
  lines.push(`  all controls detected: ${report.positiveControlsAllDetected}`);
  lines.push("");
  lines.push(`ANY FINDING, over eligible entries: ${withInterval(report.anyFinding)}`);
  lines.push(`ANY FINDING, clustered by producer: ${withInterval(report.anyFindingByProducer)}`);
  lines.push("  ^ read the clustered figure. Entries from one toolchain are not independent draws,");
  lines.push("    so the entry-level interval above is optimistic.");
  lines.push("");
  lines.push("CLUSTERING");
  lines.push(`  distinct producers        ${report.clustering.producers}`);
  lines.push(`  largest producer share    ${Number.isFinite(report.clustering.largestProducerShare) ? `${(report.clustering.largestProducerShare * 100).toFixed(1)}%` : "n/a"}`);
  lines.push(`  distinct payload digests  ${report.clustering.distinctPayloads}`);
  lines.push(`  repeated payloads         ${report.clustering.duplicatePayloads}`);
  for (const producer of report.clustering.perProducer.slice(0, 10)) {
    lines.push(`    ${String(producer.entries).padStart(4)} entries (${producer.entriesWithAnyFinding} with a finding)  ${producer.producerKey}`);
  }
  lines.push("");
  lines.push("PER CLASS, entries carrying at least one instance, over eligible entries:");
  for (const findingClass of RAW_FINDING_CLASSES) {
    lines.push(`  ${findingClass.padEnd(28)} ${withInterval(report.perClass[findingClass])}`);
  }
  lines.push("");
  lines.push("CORPUS DESCRIPTORS (a zero is meaningless without them)");
  lines.push(`  payload bytes scanned      ${report.totals.payloadBytes}`);
  lines.push(`  object members             ${report.totals.members}`);
  lines.push(`  strings                    ${report.totals.strings}`);
  lines.push(`  numbers                    ${report.totals.numbers}`);
  lines.push(`  ... of which inexact       ${report.totals.inexactNumbers}  (descriptor, not a finding: every non-dyadic decimal qualifies)`);
  lines.push(`  ... of which |v| > 2^53-1  ${report.totals.largeMagnitudeNumbers}  (denominator for unsafe-magnitude-integer)`);
  lines.push(`  malformed payloads         ${report.totals.malformedPayloads}`);
  lines.push("");
  lines.push(`NON-CLAIM: ${report.non_claim}`);
  return lines.join("\n");
}

function main(): void {
  const seed = argNumber("--seed", DEFAULT_SEED);
  const draws = argNumber("--draws", DEFAULT_DRAWS);
  const delayMs = argNumber("--delay-ms", DEFAULT_DELAY_MS);
  const frameTotalFlag = process.argv.indexOf("--frame-total");
  const frameTotal = frameTotalFlag === -1 ? undefined : Number(process.argv[frameTotalFlag + 1]);

  const report = runE12({
    seed,
    draws,
    delayMs,
    frameTotal,
    onProgress: (done, total, eligible) => {
      if (done % 50 === 0 || done === total) {
        process.stderr.write(`  ${done}/${total} drawn, ${eligible} eligible\n`);
      }
    }
  });

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(report)}\n`);
  }

  const outPath = resolve(__dirname, "../../artifacts/e12-real-traffic-kernel.json");
  mkdirSync(resolve(__dirname, "../../artifacts"), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`\nfull report written to ${outPath}\n`);
}

if (require.main === module) {
  main();
}
