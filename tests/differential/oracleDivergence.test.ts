/**
 * FSA corpus — initial injection for the Phase III Effect Oracle reconciler.
 *
 * These tests construct real HTTP/1.1 response wire bytes by hand (no mocks,
 * no HTTP client) and reconcile them against v2-shaped execution_trace
 * entries. The point is to prove the reconciler distinguishes an honest transit
 * from adversarial framing that a naive raw-hash comparison would miss.
 *
 * The receipt commits sha256 of the DECODED body — the same bytes Ghost-Ark's
 * gateway digester would have hashed — so the baselines match by construction
 * and the tampers fail on specific, named framing faults.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  OracleTransitObservation,
  reconcileReceiptAgainstOracle
} from "../../packages/research-frontier/src/oracle/byteReconciler";

const digestOf = (body: Buffer): string => `sha256:${createHash("sha256").update(body).digest("hex")}`;

function trace(sequence_num: number, response_payload_digest: string, tool_name = "PostgresTool") {
  return { sequence_num, tool_name, response_payload_digest };
}

function observe(sequenceNum: number, wireBytes: Buffer, connectionClosedCleanly = true): OracleTransitObservation {
  return { target: "127.0.0.1:8080", sequenceNum, wireBytes, connectionClosedCleanly };
}

function contentLengthResponse(body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n`),
    body
  ]);
}

function chunkedResponse(chunks: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")];
  for (const chunk of chunks) {
    parts.push(Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from("0\r\n\r\n"));
  return Buffer.concat(parts);
}

const statusAt = (report: ReturnType<typeof reconcileReceiptAgainstOracle>, seq: number): string =>
  report.findings.find((f) => f.sequenceNum === seq)?.status ?? "NO_FINDING";

describe("Effect Oracle byte reconciler — FSA corpus", () => {
  it("Baseline (Content-Length): exact decoded-body match reconciles", () => {
    const body = Buffer.from(JSON.stringify({ status: "success", action: "database_write" }));
    const report = reconcileReceiptAgainstOracle([trace(0, digestOf(body))], [observe(0, contentLengthResponse(body))]);
    expect(report.reconciled).toBe(true);
    expect(statusAt(report, 0)).toBe("MATCH");
  });

  it("Baseline (chunked): reconciler de-chunks framing before comparing", () => {
    const part1 = Buffer.from('{"status":"success",');
    const part2 = Buffer.from('"action":"database_write"}');
    const fullBody = Buffer.concat([part1, part2]);
    const report = reconcileReceiptAgainstOracle(
      [trace(0, digestOf(fullBody))],
      [observe(0, chunkedResponse([part1, part2]))]
    );
    expect(report.reconciled).toBe(true);
    expect(statusAt(report, 0)).toBe("MATCH");
  });

  it("Tamper 1 (header smuggling): body matches the digest but extra wire bytes exist → FAIL", () => {
    const body = Buffer.from(JSON.stringify({ status: "ok" }));
    const smuggledSecondResponse = Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nevil");
    const wire = Buffer.concat([contentLengthResponse(body), smuggledSecondResponse]);
    const report = reconcileReceiptAgainstOracle([trace(0, digestOf(body))], [observe(0, wire)]);
    expect(report.reconciled).toBe(false);
    expect(statusAt(report, 0)).toBe("EXTRA_WIRE_BYTES");
  });

  it("Tamper 1b (CL/TE desync): Content-Length and Transfer-Encoding together → ambiguous framing FAIL", () => {
    const wire = Buffer.from(
      "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"
    );
    const report = reconcileReceiptAgainstOracle([trace(0, digestOf(Buffer.from("hello")))], [observe(0, wire)]);
    expect(report.reconciled).toBe(false);
    expect(statusAt(report, 0)).toBe("AMBIGUOUS_FRAMING");
  });

  it("Tamper 2 (truncation): receipt claims a full body, the wire drops halfway → FAIL", () => {
    const fullBody = Buffer.from("0123456789ABCDEFGHIJ");
    const truncatedWire = Buffer.concat([
      Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${fullBody.length}\r\n\r\n`),
      fullBody.slice(0, 10)
    ]);
    const report = reconcileReceiptAgainstOracle(
      [trace(0, digestOf(fullBody))],
      [observe(0, truncatedWire, false)]
    );
    expect(report.reconciled).toBe(false);
    expect(statusAt(report, 0)).toBe("TRUNCATED");
  });

  it("A-CC echo tampering: receipt digests a CRLF-injected body the wire never carried → FAIL", () => {
    const benignBody = Buffer.from('{"ok":true}');
    const forgedBody = Buffer.from('{"ok":true}\r\nX-Injected: authorized');
    const report = reconcileReceiptAgainstOracle(
      [trace(0, digestOf(forgedBody))],
      [observe(0, contentLengthResponse(benignBody))]
    );
    expect(report.reconciled).toBe(false);
    expect(statusAt(report, 0)).toBe("DIGEST_MISMATCH");
  });

  it("Receipt claims a transit the Oracle never saw → MISSING_OBSERVATION", () => {
    const body = Buffer.from("{}");
    const report = reconcileReceiptAgainstOracle([trace(0, digestOf(body))], []);
    expect(report.reconciled).toBe(false);
    expect(statusAt(report, 0)).toBe("MISSING_OBSERVATION");
  });

  it("Oracle saw an egress the receipt never recorded → UNRECORDED_TRANSIT", () => {
    const body = Buffer.from("{}");
    const report = reconcileReceiptAgainstOracle(
      [trace(0, digestOf(body))],
      [observe(0, contentLengthResponse(body)), observe(1, contentLengthResponse(Buffer.from("exfil")))]
    );
    expect(report.reconciled).toBe(false);
    expect(statusAt(report, 0)).toBe("MATCH");
    expect(statusAt(report, 1)).toBe("UNRECORDED_TRANSIT");
  });
});
