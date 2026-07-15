/**
 * End-to-end M-measurement integration test.
 *
 * This drives the real chain — gateway transit over real TCP, real v2 receipt
 * emission/verification, real byte reconciler, real M estimator — and asserts
 * the sealed report is internally consistent and reproducible. No component is
 * mocked or reimplemented; the verifier injected here is the independent
 * Node-builtins-only .mjs verifier.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  E2E_DEV_HMAC_SECRET,
  E2EMReport,
  runE2EFsaHarness,
  verifyReportSeal
} from "../../packages/research-frontier/src/oracle/e2eFsaHarness";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- standalone verifier is an untyped Node-builtins-only .mjs module
import { verifyReceiptV2 } from "../../verifiers/node/ghost_receipt_v2_verify.mjs";

const artifactPath = join(process.cwd(), "artifacts", "local_m_report_v1.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const verifier = (receipt: any): boolean => verifyReceiptV2(receipt, { hmacSecret: E2E_DEV_HMAC_SECRET }).verdict;

function statusOf(report: E2EMReport, scenarioId: string): string {
  return report.reconciliation_summary.find((r) => r.scenarioId === scenarioId)?.reconcilerStatus ?? "NO_RECORD";
}

describe("end-to-end M measurement over the FSA corpus", () => {
  afterAll(() => {
    if (existsSync(artifactPath)) {
      rmSync(artifactPath);
    }
  });

  it("measures M from real transits and excludes receipt-invalid executions", async () => {
    const report = await runE2EFsaHarness({ verifyReceiptValid: verifier, outputPath: artifactPath });

    expect(report.execution_count).toBe(8);
    // 6 receipt-valid: 4 honest + 2 side-channel. The smuggle transit fails
    // closed (no receipt) and the tampered receipt fails verification; both drop
    // out of M's denominator.
    expect(report.m_estimate.receiptValidTotal).toBe(6);
    // 2 side-channel executions: receipt verifies, but the Oracle saw an
    // unrecorded egress the receipt never mentioned.
    expect(report.m_estimate.unsafeAmongValid).toBe(2);
    expect(report.m_estimate.pointEstimate).toBeCloseTo(2 / 6, 6);
    expect(report.m_estimate.wilsonLow).toBeGreaterThan(0.05);
    expect(report.m_estimate.falsified).toBe(true); // lower bound exceeds epsilon 0.01
  });

  it("assigns the correct reconciler verdict to each scenario class", async () => {
    const report = await runE2EFsaHarness({ verifyReceiptValid: verifier });

    expect(statusOf(report, "honest-0")).toBe("MATCH");
    // Silent compromise: a real unrecorded egress the receipt omitted.
    expect(statusOf(report, "side-channel-0")).toBe("UNRECORDED_TRANSIT");
    expect(statusOf(report, "side-channel-1")).toBe("UNRECORDED_TRANSIT");
    // Empirical finding: the strict gateway rejects trailing-byte smuggling.
    expect(statusOf(report, "smuggle-prevented-0")).toBe("PREVENTED_FAIL_CLOSED");

    const tampered = report.reconciliation_summary.find((r) => r.scenarioId === "tampered-receipt-0");
    expect(tampered?.receiptValid).toBe(false);
  });

  it("produces a cryptographically checkable seal that breaks under tampering", async () => {
    const report = await runE2EFsaHarness({ verifyReceiptValid: verifier });
    expect(verifyReportSeal(report)).toBe(true);

    const forged: E2EMReport = { ...report, m_estimate: { ...report.m_estimate, unsafeAmongValid: 0 } };
    expect(verifyReportSeal(forged)).toBe(false);
  });

  it("is byte-for-byte reproducible across runs", async () => {
    const first = await runE2EFsaHarness({ verifyReceiptValid: verifier });
    const second = await runE2EFsaHarness({ verifyReceiptValid: verifier });
    expect(second.provenance_signature).toBe(first.provenance_signature);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("writes the sealed artifact to disk and it re-verifies", async () => {
    const report = await runE2EFsaHarness({ verifyReceiptValid: verifier, outputPath: artifactPath });
    expect(existsSync(artifactPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(artifactPath, "utf8")) as E2EMReport;
    expect(onDisk.provenance_signature).toBe(report.provenance_signature);
    expect(verifyReportSeal(onDisk)).toBe(true);
  });
});
