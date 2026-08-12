import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReport,
  classifyEntry,
  computeFrame,
  drawIndices,
  producerKeyOf,
  runE12,
  runPositiveControls,
  uniformBelow,
  type DrawRecord,
  type FetchOutcome
} from "../../../tools/experiments/e12RealTrafficKernel";

/**
 * Offline guards for Arm E.
 *
 * NOTHING HERE TOUCHES THE NETWORK. Every fetch is injected. A test suite that
 * reached Rekor would be both impolite and nondeterministic, and it would make
 * the gate's verdict depend on somebody else's uptime.
 *
 * The properties pinned are the ones whose failure would produce a wrong number
 * quietly rather than a red run:
 *
 *   FRAME       the sampling frame is the SUM over shards, not the active
 *               shard's treeSize. Getting this wrong yields a frame that looks
 *               uniform, covers both retired shards in full, and truncates the
 *               newest 5% of the log.
 *   UNIFORMITY  draws must be exactly uniform. The entire licence to attach an
 *               interval rests on it.
 *   ELIGIBILITY dsse, rekord and hashedrekord store hashes and no payload. The
 *               program's pilot read 16 dsse entries as 16 payloads; they are 16
 *               hashes, and the eligible fraction is roughly a twentieth of what
 *               that reading implied.
 *   INTEGRITY   payload bytes must hash to the log's recorded payloadHash, or
 *               the entry is excluded into its own reported stratum.
 *   ACCOUNTING  an unresolved draw is counted, never dropped. Dropping one
 *               turns a network failure into a silent change of denominator.
 */

const uuid = "abc123";

function rekorResponse(options: {
  logIndex: number;
  kind: string;
  payload?: string;
  payloadHash?: string;
  serverLogIndex?: number;
}): string {
  const body = Buffer.from(
    JSON.stringify({
      apiVersion: "0.0.1",
      kind: options.kind,
      spec:
        options.payloadHash === undefined
          ? {}
          : { content: { payloadHash: { algorithm: "sha256", value: options.payloadHash } } }
    })
  ).toString("base64");

  const entry: Record<string, unknown> = { body, logIndex: options.serverLogIndex ?? options.logIndex };
  if (options.payload !== undefined) {
    entry.attestation = { data: Buffer.from(options.payload, "utf8").toString("base64") };
  }
  return JSON.stringify({ [uuid]: entry });
}

const sha256 = (text: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require("node:crypto") as typeof import("node:crypto")).createHash("sha256").update(text, "utf8").digest("hex");

describe("sampling frame", () => {
  it("sums every shard, because logIndex is global and treeSize is the active shard only", () => {
    const frame = computeFrame(
      {
        treeID: "active",
        treeSize: 2_316_292_124,
        inactiveShards: [
          { treeID: "old1", treeSize: 4_163_431 },
          { treeID: "old2", treeSize: 117_740_831 }
        ]
      },
      "2026-08-12"
    );
    expect(frame.totalIndices).toBe(2_438_196_386);
    expect(frame.shards).toHaveLength(3);
    expect(frame.shards.filter((shard) => shard.active)).toHaveLength(1);
  });

  it("does not mistake the active shard for the whole log", () => {
    const frame = computeFrame({ treeID: "a", treeSize: 100, inactiveShards: [{ treeID: "b", treeSize: 900 }] }, "d");
    expect(frame.totalIndices).not.toBe(100);
    expect(frame.totalIndices).toBe(1000);
  });
});

describe("uniform draws", () => {
  it("is reproducible from the seed and the frozen frame", () => {
    const frame = computeFrame({ treeID: "a", treeSize: 1_000_000 }, "d");
    expect(drawIndices(4242, 50, frame)).toEqual(drawIndices(4242, 50, frame));
    expect(drawIndices(4242, 50, frame)).not.toEqual(drawIndices(4243, 50, frame));
  });

  it("stays inside the frame", () => {
    const frame = computeFrame({ treeID: "a", treeSize: 997 }, "d");
    for (const index of drawIndices(7, 500, frame)) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(997);
    }
  });

  it("is uniform enough that no bucket is systematically favoured", () => {
    // The defect this guards is real and would be invisible: mapping one 32-bit
    // PRNG output onto a 2.4e9 range gives some buckets two source values and
    // others one, a bias of up to about 76% between adjacent buckets in a
    // sample whose whole claim to an interval is that the draws are uniform.
    const buckets = 10;
    const draws = 60_000;
    const counts = new Array<number>(buckets).fill(0);
    let state = 12345;
    const rng = (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let drawn = 0; drawn < draws; drawn += 1) {
      counts[uniformBelow(rng, buckets) as number] += 1;
    }
    const expected = draws / buckets;
    const chiSquared = counts.reduce((total, count) => total + (count - expected) ** 2 / expected, 0);
    // 9 degrees of freedom, upper 0.1% critical value 27.88.
    expect(chiSquared).toBeLessThan(27.88);
  });
});

describe("entry classification", () => {
  it("marks hash-only kinds ineligible rather than counting them as payloads", () => {
    for (const kind of ["dsse", "hashedrekord", "rekord"]) {
      const record = classifyEntry(5, rekorResponse({ logIndex: 5, kind }));
      expect(record.eligibility).toBe("absent-by-type");
      expect(record.scan).toBeNull();
    }
  });

  it("scans an intoto payload whose bytes hash to the recorded payloadHash", () => {
    const payload = '{"_type":"https://in-toto.io/Statement/v1","subject":[]}';
    const record = classifyEntry(
      9,
      rekorResponse({ logIndex: 9, kind: "intoto", payload, payloadHash: sha256(payload) })
    );
    expect(record.eligibility).toBe("eligible");
    expect(record.payloadBytes).toBe(Buffer.byteLength(payload));
    expect(record.scan?.wellFormed).toBe(true);
  });

  it("excludes an entry whose payload bytes do not match the recorded digest", () => {
    const record = classifyEntry(
      9,
      rekorResponse({ logIndex: 9, kind: "intoto", payload: '{"a":1}', payloadHash: "00".repeat(32) })
    );
    expect(record.eligibility).toBe("payload-digest-mismatch");
    expect(record.detail).toContain("payloadHash");
  });

  it("refuses an entry the server returned under a different logIndex", () => {
    // inclusionProof.logIndex is shard-local while the query is global; reading
    // the wrong one shifts every shard-2 sample by 4,163,431 with no error.
    const record = classifyEntry(9, rekorResponse({ logIndex: 9, kind: "intoto", serverLogIndex: 4_163_440 }));
    expect(record.eligibility).toBe("unresolved");
    expect(record.detail).toContain("logIndex");
  });

  it("finds constructs in a payload that carries them", () => {
    const payload = '{"subject":[{"n":1,"n":2}],"size":9007199254740993}';
    const record = classifyEntry(
      1,
      rekorResponse({ logIndex: 1, kind: "intoto", payload, payloadHash: sha256(payload) })
    );
    expect(record.scan?.counts["duplicate-member-name"]).toBe(1);
    expect(record.scan?.counts["unsafe-magnitude-integer"]).toBe(1);
  });
});

describe("producer attribution", () => {
  it("groups by predicate and build type without parsing the payload", () => {
    const key = producerKeyOf(
      new TextEncoder().encode(
        '{"predicateType":"https://slsa.dev/provenance/v1","predicate":{"buildDefinition":{"buildType":"https://x/workflow/v1"}}}'
      )
    );
    expect(key).toBe("https://slsa.dev/provenance/v1|https://x/workflow/v1");
  });

  it("says so when it cannot attribute, rather than inventing a group", () => {
    expect(producerKeyOf(new TextEncoder().encode('{"a":1}'))).toBe("(unattributed)");
  });
});

describe("positive controls", () => {
  it("detects every declared construct through the live decode path", () => {
    const controls = runPositiveControls();
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.detected, `control for ${control.findingClass} did not fire`).toBe(true);
    }
  });

  it("would report a miss if the decode path were broken", () => {
    // The controls are only worth reporting if they can fail. A decoder that
    // returns nothing must produce MISSED, not a silent pass.
    const controls = runPositiveControls(() => null);
    expect(controls.every((control) => !control.detected)).toBe(true);
  });
});

describe("report accounting", () => {
  const draw = (over: Partial<DrawRecord>): DrawRecord => ({
    logIndex: 1,
    kind: "intoto",
    apiVersion: "0.0.1",
    eligibility: "eligible",
    detail: null,
    payloadBytes: 10,
    payloadDigest: "d",
    producerKey: "p",
    scan: null,
    ...over
  });

  it("counts unresolved draws instead of shrinking the denominator", () => {
    const report = buildReport({
      corpus: "test",
      seed: 1,
      frame: computeFrame({ treeID: "a", treeSize: 10 }, "d"),
      requestedDraws: 3,
      draws: [draw({ eligibility: "unresolved" }), draw({ eligibility: "absent-by-type" }), draw({})]
    });
    expect(report.unresolvedDraws).toBe(1);
    expect(report.resolvedDraws).toBe(2);
    expect(report.complete).toBe(false);
  });

  it("suppresses an interval below the minimum n rather than reporting a wide one", () => {
    const report = buildReport({
      corpus: "test",
      seed: 1,
      frame: computeFrame({ treeID: "a", treeSize: 10 }, "d"),
      requestedDraws: 2,
      draws: [draw({}), draw({})]
    });
    expect(report.anyFinding.interval).toBeNull();
    expect(report.anyFinding.intervalOmittedBecause).toContain("MIN_N_FOR_PROPORTION_INTERVAL");
  });

  it("reports a producer-clustered proportion beside the entry-level one", () => {
    const draws = [
      ...Array.from({ length: 40 }, () => draw({ producerKey: "one", payloadDigest: "same" })),
      draw({ producerKey: "two", payloadDigest: "other" })
    ];
    const report = buildReport({
      corpus: "test",
      seed: 1,
      frame: computeFrame({ treeID: "a", treeSize: 10 }, "d"),
      requestedDraws: draws.length,
      draws
    });
    expect(report.clustering.producers).toBe(2);
    expect(report.clustering.largestProducerShare).toBeCloseTo(40 / 41, 5);
    // 40 of 41 entries carry one payload; treating them as 41 independent
    // observations is the defect the clustered figure exists to expose.
    expect(report.clustering.distinctPayloads).toBe(2);
    expect(report.clustering.duplicatePayloads).toBe(39);
    expect(report.anyFindingByProducer.total).toBe(2);
  });

  it("never reports a proportion over an empty denominator", () => {
    const report = buildReport({
      corpus: "test",
      seed: 1,
      frame: computeFrame({ treeID: "a", treeSize: 10 }, "d"),
      requestedDraws: 1,
      draws: [draw({ eligibility: "absent-by-type" })]
    });
    expect(report.anyFinding.interval).toBeNull();
    expect(report.anyFinding.intervalOmittedBecause).toContain("no denominator");
  });
});

describe("runner", () => {
  it("records a fetch failure as an unresolved draw and keeps going", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "ghost-ark-e12-"));
    let call = 0;
    const fetcher = (url: string): FetchOutcome => {
      if (url.endsWith("/api/v1/log")) {
        return { ok: true, body: JSON.stringify({ treeID: "a", treeSize: 1000 }), detail: "injected" };
      }
      call += 1;
      if (call === 2) {
        return { ok: false, body: null, detail: "curl exit 22: HTTP 500" };
      }
      const index = Number(new URL(url).searchParams.get("logIndex"));
      return { ok: true, body: rekorResponse({ logIndex: index, kind: "dsse" }), detail: "injected" };
    };

    const report = runE12({ seed: 11, draws: 4, delayMs: 0, cacheDir, fetcher });
    expect(report.unresolvedDraws).toBe(1);
    expect(report.draws).toHaveLength(4);
    expect(report.complete).toBe(false);
    expect(report.draws.find((entry) => entry.eligibility === "unresolved")?.detail).toContain("500");
  });

  it("refuses to run a seed whose pre-registered index list would change", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "ghost-ark-e12-"));
    const fetcherFor = (treeSize: number) => (url: string): FetchOutcome =>
      url.endsWith("/api/v1/log")
        ? { ok: true, body: JSON.stringify({ treeID: "a", treeSize }), detail: "injected" }
        : { ok: true, body: rekorResponse({ logIndex: 0, kind: "dsse" }), detail: "injected" };

    runE12({ seed: 5, draws: 3, delayMs: 0, cacheDir, fetcher: fetcherFor(1000) });
    // Same seed and n, a grown log: the drawn indices differ, which is exactly
    // the situation where a post-hoc sample change would otherwise be invisible.
    expect(() => runE12({ seed: 5, draws: 3, delayMs: 0, cacheDir, fetcher: fetcherFor(2000) })).toThrow(
      /pre-registration/u
    );
  });
});
