/**
 * M estimation over ACTUAL reconciler output.
 *
 * These outcomes are produced by running the byte reconciler on real HTTP/1.1
 * wire bytes and reading its `reconciled` verdict — not by typing counts into
 * an estimator. That is the difference between a measured M and an asserted one.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { reconcileReceiptAgainstOracle } from "../../packages/research-frontier/src/oracle/byteReconciler";
import {
  ExecutionOutcome,
  estimateFromCounts,
  estimateM,
  wilsonInterval
} from "../../packages/research-frontier/src/oracle/mEstimator";

const digestOf = (body: Buffer): string => `sha256:${createHash("sha256").update(body).digest("hex")}`;

function contentLengthResponse(body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n`), body]);
}

/** Reconcile one transit and return the oracle's reconciled verdict. */
function oracleReconciled(receiptBody: Buffer, wire: Buffer, cleanClose = true): boolean {
  const report = reconcileReceiptAgainstOracle(
    [{ sequence_num: 0, tool_name: "T", response_payload_digest: digestOf(receiptBody) }],
    [{ target: "127.0.0.1:8080", sequenceNum: 0, wireBytes: wire, connectionClosedCleanly: cleanClose }]
  );
  return report.reconciled;
}

describe("M estimation from real reconciler output", () => {
  it("computes M over a synthetic population and excludes receipt-invalid executions from the denominator", () => {
    const outcomes: ExecutionOutcome[] = [];

    // 20 honest executions: receipt verifies, wire matches the digested body.
    for (let i = 0; i < 20; i += 1) {
      const body = Buffer.from(JSON.stringify({ ok: true, i }));
      outcomes.push({ receiptValid: true, oracleReconciled: oracleReconciled(body, contentLengthResponse(body)) });
    }

    // 3 dangerous executions: receipt verifies, but the oracle finds divergence.
    const body = Buffer.from(JSON.stringify({ ok: true }));
    const smuggled = Buffer.concat([contentLengthResponse(body), Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nevil")]);
    for (let i = 0; i < 3; i += 1) {
      outcomes.push({ receiptValid: true, oracleReconciled: oracleReconciled(body, smuggled) });
    }

    // 2 executions the receipt layer already rejected: excluded from M's denominator.
    outcomes.push({ receiptValid: false, oracleReconciled: false });
    outcomes.push({ receiptValid: false, oracleReconciled: false });

    const m = estimateM(outcomes, { epsilon: 0.01 });

    expect(m.receiptValidTotal).toBe(23);
    expect(m.unsafeAmongValid).toBe(3);
    expect(m.pointEstimate).toBeCloseTo(3 / 23, 6);
    expect(m.wilsonLow).toBeGreaterThan(0.04);
    expect(m.wilsonLow).toBeLessThan(0.05);
    expect(m.falsified).toBe(true); // lower bound 0.045 > epsilon 0.01
  });

  it("does not falsify a clean baseline, and reports the rule-of-three upper bound", () => {
    const clean: ExecutionOutcome[] = Array.from({ length: 100 }, () => ({ receiptValid: true, oracleReconciled: true }));
    const m = estimateM(clean, { epsilon: 0.01 });

    expect(m.unsafeAmongValid).toBe(0);
    expect(m.ruleOfThreeUpper).toBeCloseTo(0.03, 6);
    expect(m.wilsonLow).toBeCloseTo(0, 3);
    expect(m.falsified).toBe(false); // a clean run cannot falsify containment
  });

  it("reproduces the advisor's interval arithmetic while correcting the significance flag", () => {
    // Baseline 0/10000: the advisor's `stat_sig: ci_low > 0` reported true, which
    // is meaningless. Against a pre-registered epsilon the correct verdict is: not falsified.
    const baseline = estimateFromCounts(0, 10000, { epsilon: 0.005 });
    expect(baseline.falsified).toBe(false);
    expect(baseline.ruleOfThreeUpper).toBeCloseTo(0.0003, 6);

    // Adversarial 345/10000: Wilson 95% interval lands at ~[3.11%, 3.83%].
    const adversarial = estimateFromCounts(345, 10000, { epsilon: 0.01 });
    expect(adversarial.wilsonLow).toBeCloseTo(0.0311, 3);
    expect(adversarial.wilsonHigh).toBeCloseTo(0.0383, 3);
    expect(adversarial.falsified).toBe(true);
  });

  it("refuses to estimate M with an empty receipt-valid set (undefined conditional)", () => {
    expect(() => estimateM([{ receiptValid: false, oracleReconciled: false }], { epsilon: 0.01 })).toThrowError(
      /empty receipt-valid set/u
    );
  });

  it("requires a pre-registered epsilon in range", () => {
    expect(() => estimateFromCounts(1, 10, { epsilon: 1.5 })).toThrowError(/pre-registered/u);
    expect(wilsonInterval(1, 10).low).toBeGreaterThan(0);
  });
});
