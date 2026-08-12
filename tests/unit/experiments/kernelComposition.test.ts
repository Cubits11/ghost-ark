import { describe, expect, it } from "vitest";

import {
  buildHops,
  enumerateFiniteModel,
  isAcceptable,
  runE13,
  type Hop
} from "../../../tools/experiments/e13KernelComposition";
import { PATHOLOGY_ALPHABET } from "../../../tools/experiments/kernelAlphabet";

/**
 * Guards for Arm F.
 *
 * The finite-model half is fast and deterministic, so it runs in full here — an
 * exhaustive enumeration is a stronger guard than any sample of it. The
 * real-implementation half spawns subprocesses, so the suite drives it with
 * synthetic in-process hops whose composition behaviour is known by
 * construction, and touches the real hops only in one explicitly budgeted test.
 *
 * The property most worth pinning is REPAIR IMPOSSIBILITY: once a hop maps two
 * documents to one canonical form without rejecting them, no downstream hop can
 * separate them again. That is the claim with a practical consequence — you
 * cannot audit an upstream collapse away downstream, you can only refuse to
 * build on it — so it is checked exhaustively rather than argued.
 */

describe("finite model", () => {
  const model = enumerateFiniteModel();

  it("enumerates every hop and every ordered composition", () => {
    expect(model.functionCount).toBe(625);
    expect(model.orderedPairCount).toBe(390_625);
  });

  it("finds that soundness does not compose forward", () => {
    // Two hops each acceptable on the alphabet, composite not. This is the
    // conjecture's forward direction, settled by exhibited witnesses.
    expect(model.soundPlusSoundGivesUnsound).toBeGreaterThan(0);
    expect(model.witnessForward).toBeTruthy();
  });

  it("finds that an unacceptable hop does not force an unacceptable chain", () => {
    expect(model.unsoundHopGivesSoundChain).toBeGreaterThan(0);
  });

  it("never separates a pair an upstream hop already collapsed", () => {
    // Repair impossibility. A non-zero here would refute the claim, and that
    // refutation would matter more than the claim does.
    expect(model.repairBySeparation).toBe(0);
  });

  it("finds that rejection is the only mechanism that neutralizes an upstream collapse", () => {
    expect(model.repairByRejection).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(enumerateFiniteModel()).toEqual(model);
  });
});

describe("verdict polarity is imported from E1, not re-decided", () => {
  it("treats refusal as acceptable and a false identity as not", () => {
    expect(isAcceptable("sound")).toBe(true);
    expect(isAcceptable("fail-closed")).toBe(true);
    expect(isAcceptable("sound-by-rejection")).toBe(true);
    expect(isAcceptable("unintended-kernel")).toBe(false);
    expect(isAcceptable("over-discrimination")).toBe(false);
    expect(isAcceptable("rejection-asymmetry")).toBe(false);
  });
});

describe("composition over synthetic hops with known behaviour", () => {
  const passthrough: Hop = {
    id: "passthrough",
    language: "test",
    description: "returns its input unchanged",
    origin: "ghost-ark",
    run: (input) => ({ status: "bytes", bytes: input })
  };

  const collapseAll: Hop = {
    id: "collapse-all",
    language: "test",
    description: "maps every input to one constant",
    origin: "ghost-ark",
    run: () => ({ status: "bytes", bytes: Buffer.from("CONSTANT") })
  };

  const refuseAll: Hop = {
    id: "refuse-all",
    language: "test",
    description: "accepts nothing",
    origin: "ghost-ark",
    run: () => ({ status: "rejected", reason: "refuses everything" })
  };

  const alphabet = PATHOLOGY_ALPHABET.slice(0, 6);

  it("reports a degenerate hop as unacceptable wherever intent is distinct", () => {
    const report = runE13(alphabet, [collapseAll]);
    const distinctCells = report.cells.filter((cell) => cell.intent === "distinct");
    expect(distinctCells.length).toBeGreaterThan(0);
    for (const cell of distinctCells) {
      expect(cell.compositeVerdict).toBe("unintended-kernel");
    }
  });

  it("shows a downstream refusal neutralizing an upstream collapse", () => {
    const report = runE13(alphabet, [collapseAll, refuseAll]);
    const chain = report.cells.filter((cell) => cell.firstHop === "collapse-all" && cell.secondHop === "refuse-all");
    expect(chain.length).toBe(alphabet.length);
    for (const cell of chain) {
      expect(cell.compositeVerdict).toBe("fail-closed");
      expect(cell.repairMechanism).not.toBe("separation");
    }
  });

  it("never records a repair by separation, matching the finite-model result", () => {
    const report = runE13(alphabet, [passthrough, collapseAll, refuseAll]);
    expect(report.separationRepairs).toEqual([]);
  });

  it("leaves a byte-identity hop's verdicts unchanged under self-composition", () => {
    const report = runE13(alphabet, [passthrough]);
    expect(report.nonIdempotentHops).toEqual([]);
    for (const cell of report.cells) {
      expect(cell.compositeVerdict).toBe(cell.firstVerdict);
    }
  });

  it("covers every ordered pair including self-composition", () => {
    const report = runE13(alphabet, [passthrough, collapseAll]);
    expect(report.cellCount).toBe(2 * 2 * alphabet.length);
  });
});

describe("real hops", () => {
  it(
    "carries intermediates as bytes, so an unpaired surrogate survives the harness",
    () => {
      // The failure this guards is silent and total: `execFileSync` with a
      // STRING input encodes it as UTF-8, and encoding a JS string holding an
      // unpaired surrogate replaces it with U+FFFD. The lone-surrogate class
      // would then be compared against its own control before any hop ran.
      const hops = buildHops();
      const identity = hops.find((hop) => hop.id === "strict-duplicate-gate");
      expect(identity).toBeDefined();
      const raw = Buffer.from('{"v":"\\ud800"}', "binary");
      const outcome = identity?.run(raw);
      expect(outcome?.status).toBe("bytes");
      if (outcome?.status === "bytes") {
        expect(outcome.bytes.equals(raw)).toBe(true);
      }
    },
    30_000
  );

  it(
    "rejects a document whose raw bytes carry a duplicate member name",
    () => {
      const gate = buildHops().find((hop) => hop.id === "strict-duplicate-gate");
      expect(gate?.run(Buffer.from('{"a":1,"a":2}'))).toMatchObject({ status: "rejected" });
      expect(gate?.run(Buffer.from('{"a":1,"b":2}'))).toMatchObject({ status: "bytes" });
    },
    30_000
  );

  it(
    "produces a report over the hops present on this machine",
    () => {
      const report = runE13(PATHOLOGY_ALPHABET.slice(0, 4));
      expect(report.hops.length).toBeGreaterThan(0);
      expect(report.cellCount).toBe(report.hops.length * report.hops.length * 4);
      // Whatever the search finds, repair impossibility must hold against real
      // software too. If it ever does not, the finite-model result is wrong and
      // that is the finding.
      expect(report.separationRepairs).toEqual([]);
    },
    180_000
  );
});
