import { createHash } from "crypto";

/**
 * Phase III byte reconciler (research-only, clean-room).
 *
 * Independence boundary:
 * - computes all digests with node:crypto directly; does NOT call Ghost-Ark's
 *   canonicalizer, digester, or emitter to recompute anything;
 * - treats the receipt as untrusted external input and validates its shape
 *   defensively;
 * - has no dependency on the gateway, runtime, or receipt packages beyond a
 *   compile-time-only view interface.
 *
 * The load-bearing correction over a naive design: the Effect Oracle records
 * transport-layer wire bytes, while the receipt commits the digest of the
 * DECODED HTTP body. The wire additionally carries the status line, headers,
 * and chunked-transfer framing the app-layer digest never sees. Comparing the
 * raw wire hash to the receipt digest therefore diverges on every legitimate
 * response. This reconciler decodes the HTTP/1.1 framing first, then compares
 * the decoded-body digest — and separately reports framing faults (smuggling,
 * truncation, ambiguous length) that a pure digest comparison would miss.
 *
 * Scope boundary: this reconciles plaintext HTTP/1.1 response bytes as seen at
 * the proxy. Under HTTPS the transparent observer sees ciphertext and cannot
 * reconstruct the body; body reconciliation then requires a TLS-terminating
 * proxy, which shares TLS trust with the observed path. That is a real
 * reduction in independence and must be stated wherever this runs, not hidden.
 */

export type ReconciliationStatus =
  | "MATCH"
  | "DIGEST_MISMATCH"
  | "EXTRA_WIRE_BYTES"
  | "TRUNCATED"
  | "AMBIGUOUS_FRAMING"
  | "MALFORMED"
  | "MISSING_OBSERVATION"
  | "UNRECORDED_TRANSIT";

export interface OracleTransitObservation {
  /** host:port the bytes egressed to, as recorded by the transparent observer. */
  target: string;
  /** Content-addressed correlation index, not a timestamp. */
  sequenceNum: number;
  /** Raw HTTP/1.1 response bytes as seen at the proxy (post-TLS if terminating). */
  wireBytes: Buffer;
  /** Whether the transport connection closed cleanly (FIN, not reset/timeout). */
  connectionClosedCleanly: boolean;
}

/** Minimal defensive view of a receipt execution_trace entry. */
export interface ReceiptTraceView {
  sequence_num: number;
  tool_name: string;
  response_payload_digest: string;
}

export interface ReconciliationFinding {
  sequenceNum: number;
  status: ReconciliationStatus;
  detail: string;
}

export interface ReconciliationReport {
  reconciled: boolean;
  findings: ReconciliationFinding[];
}

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;
const HEADER_BODY_SEPARATOR = Buffer.from("\r\n\r\n");
const CRLF = Buffer.from("\r\n");
const MAX_WIRE_BYTES = 8 * 1024 * 1024;

type FramingFault = "AMBIGUOUS_FRAMING" | "TRUNCATED" | "MALFORMED";

interface DecodedResponse {
  decodedBody: Buffer;
  trailingBytes: number;
  fault?: FramingFault;
}

function sha256Digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseHeaders(headerBlock: Buffer): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  const lines = headerBlock.toString("latin1").split("\r\n");
  // lines[0] is the status line; header lines follow.
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const existing = headers.get(name);
    if (existing) {
      existing.push(value);
    } else {
      headers.set(name, [value]);
    }
  }
  return headers;
}

function dechunk(body: Buffer, cleanClose: boolean): DecodedResponse {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf(CRLF, offset);
    if (lineEnd === -1) {
      return { decodedBody: Buffer.concat(parts), trailingBytes: 0, fault: "TRUNCATED" };
    }
    const sizeToken = body.slice(offset, lineEnd).toString("ascii").split(";")[0].trim();
    if (!/^[0-9a-fA-F]+$/u.test(sizeToken)) {
      return { decodedBody: Buffer.concat(parts), trailingBytes: 0, fault: "MALFORMED" };
    }
    const chunkSize = parseInt(sizeToken, 16);
    offset = lineEnd + CRLF.length;

    if (chunkSize === 0) {
      // Terminal chunk. Consume an optional terminating CRLF; anything after is smuggled.
      if (body.slice(offset, offset + CRLF.length).equals(CRLF)) {
        offset += CRLF.length;
      }
      return { decodedBody: Buffer.concat(parts), trailingBytes: body.length - offset };
    }

    if (offset + chunkSize > body.length) {
      parts.push(body.slice(offset));
      return { decodedBody: Buffer.concat(parts), trailingBytes: 0, fault: "TRUNCATED" };
    }
    parts.push(body.slice(offset, offset + chunkSize));
    offset += chunkSize;
    if (!body.slice(offset, offset + CRLF.length).equals(CRLF)) {
      return { decodedBody: Buffer.concat(parts), trailingBytes: 0, fault: "MALFORMED" };
    }
    offset += CRLF.length;
  }
  // Ran out of bytes without a terminal 0-length chunk.
  return { decodedBody: Buffer.concat(parts), trailingBytes: 0, fault: cleanClose ? "MALFORMED" : "TRUNCATED" };
}

export function decodeHttpResponse(wire: Buffer, cleanClose: boolean): DecodedResponse {
  if (wire.length > MAX_WIRE_BYTES) {
    return { decodedBody: Buffer.alloc(0), trailingBytes: 0, fault: "MALFORMED" };
  }
  const separator = wire.indexOf(HEADER_BODY_SEPARATOR);
  if (separator === -1) {
    // No complete header block: either truncated before headers or malformed.
    return { decodedBody: Buffer.alloc(0), trailingBytes: 0, fault: cleanClose ? "MALFORMED" : "TRUNCATED" };
  }
  const headers = parseHeaders(wire.slice(0, separator));
  const bodyBytes = wire.slice(separator + HEADER_BODY_SEPARATOR.length);

  const transferEncoding = headers.get("transfer-encoding");
  const contentLength = headers.get("content-length");

  // RFC 7230 3.3.3: Content-Length together with Transfer-Encoding, or
  // conflicting duplicate Content-Length values, is a request/response
  // smuggling vector and must be treated as an error, never silently resolved.
  if (transferEncoding && contentLength) {
    return { decodedBody: Buffer.alloc(0), trailingBytes: bodyBytes.length, fault: "AMBIGUOUS_FRAMING" };
  }
  if (contentLength && new Set(contentLength.map((v) => v.trim())).size > 1) {
    return { decodedBody: Buffer.alloc(0), trailingBytes: bodyBytes.length, fault: "AMBIGUOUS_FRAMING" };
  }

  if (transferEncoding) {
    if (!transferEncoding.some((v) => v.toLowerCase().includes("chunked"))) {
      return { decodedBody: bodyBytes, trailingBytes: 0, fault: "MALFORMED" };
    }
    return dechunk(bodyBytes, cleanClose);
  }

  if (contentLength) {
    const declared = Number(contentLength[0]);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      return { decodedBody: Buffer.alloc(0), trailingBytes: 0, fault: "MALFORMED" };
    }
    if (bodyBytes.length < declared) {
      return { decodedBody: bodyBytes, trailingBytes: 0, fault: "TRUNCATED" };
    }
    return { decodedBody: bodyBytes.slice(0, declared), trailingBytes: bodyBytes.length - declared };
  }

  // No explicit framing: only a clean close delimits a complete body.
  if (!cleanClose) {
    return { decodedBody: bodyBytes, trailingBytes: 0, fault: "TRUNCATED" };
  }
  return { decodedBody: bodyBytes, trailingBytes: 0 };
}

function reconcileOne(trace: ReceiptTraceView, observation: OracleTransitObservation): ReconciliationFinding {
  const decoded = decodeHttpResponse(observation.wireBytes, observation.connectionClosedCleanly);
  const base = { sequenceNum: trace.sequence_num };

  if (decoded.fault === "AMBIGUOUS_FRAMING") {
    return { ...base, status: "AMBIGUOUS_FRAMING", detail: `Tool ${trace.tool_name}: wire framing is ambiguous (Content-Length/Transfer-Encoding conflict); a smuggling vector.` };
  }
  if (decoded.fault === "MALFORMED") {
    return { ...base, status: "MALFORMED", detail: `Tool ${trace.tool_name}: wire bytes did not parse as a well-formed HTTP/1.1 response.` };
  }
  if (decoded.fault === "TRUNCATED") {
    return { ...base, status: "TRUNCATED", detail: `Tool ${trace.tool_name}: wire response is truncated relative to its declared framing; receipt claims a complete body.` };
  }
  if (decoded.trailingBytes > 0) {
    return { ...base, status: "EXTRA_WIRE_BYTES", detail: `Tool ${trace.tool_name}: ${decoded.trailingBytes} wire byte(s) beyond the declared body were never digested by the receipt.` };
  }
  const observedDigest = sha256Digest(decoded.decodedBody);
  if (observedDigest !== trace.response_payload_digest) {
    return { ...base, status: "DIGEST_MISMATCH", detail: `Tool ${trace.tool_name}: decoded-body digest ${observedDigest} does not match receipt ${trace.response_payload_digest}.` };
  }
  return { ...base, status: "MATCH", detail: `Tool ${trace.tool_name}: decoded-body digest matches the receipt commitment.` };
}

function assertTraceView(value: unknown, index: number): ReceiptTraceView {
  if (!value || typeof value !== "object") {
    throw new Error(`execution_trace[${index}] is not an object.`);
  }
  const entry = value as Record<string, unknown>;
  if (!Number.isSafeInteger(entry.sequence_num)) {
    throw new Error(`execution_trace[${index}].sequence_num is not an integer.`);
  }
  if (typeof entry.tool_name !== "string") {
    throw new Error(`execution_trace[${index}].tool_name is not a string.`);
  }
  if (typeof entry.response_payload_digest !== "string" || !sha256DigestPattern.test(entry.response_payload_digest)) {
    throw new Error(`execution_trace[${index}].response_payload_digest is not a sha256 digest.`);
  }
  return {
    sequence_num: entry.sequence_num as number,
    tool_name: entry.tool_name,
    response_payload_digest: entry.response_payload_digest
  };
}

/**
 * Reconcile a receipt's execution_trace against independent Oracle
 * observations. Correlation is by sequence_num (content-addressed), never by
 * timestamp, so garbage-collection or scheduling drift between user-space and
 * kernel-space clocks cannot produce false divergence. Every claimed transit
 * must have an observation and every observation must have a claimed transit;
 * an unmatched entry on either side is itself a divergence.
 */
export function reconcileReceiptAgainstOracle(
  executionTrace: readonly unknown[],
  observations: readonly OracleTransitObservation[]
): ReconciliationReport {
  const traces = executionTrace.map((entry, index) => assertTraceView(entry, index));
  const observationBySeq = new Map<number, OracleTransitObservation>();
  for (const observation of observations) {
    observationBySeq.set(observation.sequenceNum, observation);
  }
  const traceSeqs = new Set(traces.map((t) => t.sequence_num));
  const findings: ReconciliationFinding[] = [];

  for (const trace of traces) {
    const observation = observationBySeq.get(trace.sequence_num);
    if (!observation) {
      findings.push({
        sequenceNum: trace.sequence_num,
        status: "MISSING_OBSERVATION",
        detail: `Receipt claims a transit for ${trace.tool_name} at sequence ${trace.sequence_num} that the Oracle never observed on the wire.`
      });
      continue;
    }
    findings.push(reconcileOne(trace, observation));
  }

  for (const observation of observations) {
    if (!traceSeqs.has(observation.sequenceNum)) {
      findings.push({
        sequenceNum: observation.sequenceNum,
        status: "UNRECORDED_TRANSIT",
        detail: `Oracle observed an egress transit to ${observation.target} at sequence ${observation.sequenceNum} with no corresponding receipt entry.`
      });
    }
  }

  findings.sort((a, b) => a.sequenceNum - b.sequenceNum || a.status.localeCompare(b.status));
  return { reconciled: findings.every((f) => f.status === "MATCH"), findings };
}
