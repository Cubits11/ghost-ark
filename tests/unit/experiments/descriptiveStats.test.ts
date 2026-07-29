import { describe, expect, it } from "vitest";
import {
  MIN_N_FOR_PROPORTION_INTERVAL,
  assertCensusReporting,
  percentile,
  reportProportion,
  summarize
} from "../../../packages/research-frontier/src/stats/descriptive";
import { wilsonInterval } from "../../../packages/research-frontier/src/oracle/mEstimator";

describe("percentile", () => {
  it("uses nearest-rank and never interpolates a value that was not observed", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // An interpolating implementation would return 5.5 for the median here. Nearest
    // rank must return an actually-observed value.
    expect(sorted).toContain(percentile(sorted, 0.5));
    expect(percentile(sorted, 0.5)).toBe(5);
  });

  it("pins known ranks", () => {
    const sorted = [10, 20, 30, 40];
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile(sorted, 0.25)).toBe(10);
    expect(percentile(sorted, 0.5)).toBe(20);
    expect(percentile(sorted, 0.75)).toBe(30);
    expect(percentile(sorted, 1)).toBe(40);
  });

  it("rejects an empty sample and an out-of-range fraction", () => {
    expect(() => percentile([], 0.5)).toThrow(/at least one observation/u);
    expect(() => percentile([1], 1.5)).toThrow(/within \[0, 1\]/u);
    expect(() => percentile([1], -0.1)).toThrow(/within \[0, 1\]/u);
  });
});

describe("summarize", () => {
  it("computes mean, IQR, and a Bessel-corrected standard deviation against hand-checked values", () => {
    // Sample: 2, 4, 4, 4, 5, 5, 7, 9. mean = 40/8 = 5.
    // Squared deviations sum = 9+1+1+1+0+0+4+16 = 32. Sample variance = 32/7.
    const summary = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(summary.n).toBe(8);
    expect(summary.mean).toBe(5);
    expect(summary.stdDev).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(summary.min).toBe(2);
    expect(summary.max).toBe(9);
    expect(summary.iqr).toBe(summary.p75 - summary.p25);
  });

  it("returns null stdDev at n = 1 rather than pretending dispersion is zero", () => {
    const summary = summarize([42]);
    expect(summary.n).toBe(1);
    expect(summary.stdDev).toBeNull();
    expect(summary.iqr).toBe(0);
  });

  it("orders percentiles monotonically on random input", () => {
    const observations = Array.from({ length: 500 }, (_unused, index) => ((index * 7919) % 1000) / 10);
    const summary = summarize(observations);
    expect(summary.min).toBeLessThanOrEqual(summary.p25);
    expect(summary.p25).toBeLessThanOrEqual(summary.p50);
    expect(summary.p50).toBeLessThanOrEqual(summary.p75);
    expect(summary.p75).toBeLessThanOrEqual(summary.p95);
    expect(summary.p95).toBeLessThanOrEqual(summary.p99);
    expect(summary.p99).toBeLessThanOrEqual(summary.max);
  });

  it("rejects non-finite observations instead of producing NaN summaries", () => {
    expect(() => summarize([1, Number.NaN])).toThrow(/finite/u);
    expect(() => summarize([1, Number.POSITIVE_INFINITY])).toThrow(/finite/u);
    expect(() => summarize([])).toThrow(/at least one observation/u);
  });

  it("does not mutate the caller's array", () => {
    const observations = [3, 1, 2];
    summarize(observations);
    expect(observations).toEqual([3, 1, 2]);
  });
});

describe("census reporting discipline", () => {
  it("refuses to attach a confidence interval to a curated census", () => {
    expect(() => assertCensusReporting("census", "26-fixture malicious corpus")).toThrow(/Refusing to attach a confidence interval/u);
    expect(() => assertCensusReporting("sampled", "randomized generator")).not.toThrow();
  });

  it("omits the interval for a census and states why", () => {
    const report = reportProportion(26, 26, "census", () => {
      throw new Error("must not be called for a census");
    });
    expect(report.observed).toBe(1);
    expect(report.interval).toBeNull();
    expect(report.intervalOmittedBecause).toMatch(/whole population/u);
  });

  it("omits the interval for a sample below the minimum n, naming the threshold", () => {
    // This is the exact defect the module exists to prevent: a Wilson interval on
    // 2/2 successes, previously published as a "robust statistical lower bound".
    const report = reportProportion(2, 2, "sampled", wilsonInterval);
    expect(report.interval).toBeNull();
    expect(report.intervalOmittedBecause).toContain(`MIN_N_FOR_PROPORTION_INTERVAL = ${MIN_N_FOR_PROPORTION_INTERVAL}`);
  });

  it("demonstrates why n = 2 was rejected: the interval admits a rate near one third", () => {
    const { low } = wilsonInterval(2, 2);
    expect(low).toBeLessThan(0.4);
  });

  it("attaches an interval for a genuine sample at or above the minimum n", () => {
    const report = reportProportion(30, 30, "sampled", wilsonInterval);
    expect(report.interval).not.toBeNull();
    expect(report.interval?.low).toBeGreaterThan(0.8);
    expect(report.interval?.high).toBeLessThanOrEqual(1);
    expect(report.intervalOmittedBecause).toBeNull();
  });

  it("rejects impossible proportions", () => {
    expect(() => reportProportion(5, 4, "sampled", wilsonInterval)).toThrow(/0 <= successes <= total/u);
    expect(() => reportProportion(-1, 4, "sampled", wilsonInterval)).toThrow(/0 <= successes <= total/u);
    expect(() => reportProportion(0, 0, "sampled", wilsonInterval)).toThrow(/total > 0/u);
  });
});
