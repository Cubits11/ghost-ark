import * as net from "net";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { canonicalize, sha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { executeGovernedTransit } from "../../../enforcement-runtime/src/gateway/sidecarProxy";
import {
  buildUnsignedDecisionReceiptV2,
  executionTraceFromTransitRecords,
  SignedDecisionReceiptV2,
  signDecisionReceiptV2
} from "../../../enforcement-runtime/src/receipts/v2/emission";
import {
  LocalDevHmacReceiptSigner,
  decodeDecisionReceiptSignatureEnvelope,
  encodeDecisionReceiptSignatureEnvelope
} from "../../../enforcement-runtime/src/receipts/signer";
import { privateHmacDigest, publicSha256Digest } from "../../../enforcement-runtime/src/receipts/canonical";
import { reconcileReceiptAgainstOracle } from "./byteReconciler";
import { estimateM, ExecutionOutcome, MEstimate } from "./mEstimator";

/**
 * End-to-end M-measurement harness (research-only, local, zero cloud).
 *
 * Closes the Phase III loop in a single Node process while keeping three
 * distinct trust domains in separate memory:
 *   - Generation: the FSA payload transits the gateway (executeGovernedTransit),
 *     which digests the decoded body and yields a signed v2 receipt.
 *   - Oracle: a transparent loopback tee proxy on the wire path captures the
 *     exact response bytes into a buffer the gateway holds no reference to. It
 *     is NOT the target and NOT the gateway.
 *   - Evaluation: an injected v2 verifier assigns receiptValid; the byte
 *     reconciler assigns oracleReconciled from the captured wire bytes.
 * Outcomes feed the M estimator under a pre-registered epsilon, and the report
 * is sealed with a dev HMAC envelope (NOT KMS/RSA-PSS — that is the AWS-mode
 * upgrade, not something to fabricate locally).
 *
 * Non-claims: not a cloud run; not field behavior of a live agent; governedInvoke
 * does not emit v2 receipts yet, so this exercises the mechanical chain in
 * isolation. M here is over a synthetic corpus, not a field rate.
 */

export const E2E_DEV_HMAC_SECRET = "ghost-ark-e2e-fsa-harness-dev-only";
export const E2E_CORPUS_VERSION = "fsa-local-v1";
const SIGNATURE_ENVELOPE_SCHEMA = "ghost.decision_receipt_signature.v1" as const;

export type WireMode = "honest" | "smuggle_trailing";

interface FsaScenario {
  id: string;
  wireMode: WireMode;
  tamperReceipt: boolean;
}

const FSA_CORPUS: readonly FsaScenario[] = [
  { id: "honest-0", wireMode: "honest", tamperReceipt: false },
  { id: "honest-1", wireMode: "honest", tamperReceipt: false },
  { id: "honest-2", wireMode: "honest", tamperReceipt: false },
  { id: "honest-3", wireMode: "honest", tamperReceipt: false },
  { id: "honest-4", wireMode: "honest", tamperReceipt: false },
  { id: "smuggle-0", wireMode: "smuggle_trailing", tamperReceipt: false },
  { id: "smuggle-1", wireMode: "smuggle_trailing", tamperReceipt: false },
  { id: "tampered-0", wireMode: "honest", tamperReceipt: true }
];

export interface E2EExecutionRecord {
  index: number;
  scenarioId: string;
  receiptValid: boolean;
  oracleReconciled: boolean;
  reconcilerStatus: string;
}

export interface E2EMReport {
  corpus_version: string;
  epsilon_threshold: number;
  confidence_label: number;
  execution_count: number;
  m_estimate: MEstimate;
  reconciliation_summary: E2EExecutionRecord[];
  sealing_mode: "LOCAL_HMAC_SHA256_DEV_ONLY";
  provenance_signature: string;
}

export interface E2EHarnessOptions {
  verifyReceiptValid: (receipt: SignedDecisionReceiptV2) => boolean;
  epsilon?: number;
  hmacSecret?: string;
  outputPath?: string;
}

function honestWire(body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`),
    body
  ]);
}

function smugglingWire(body: Buffer): Buffer {
  // A valid Content-Length response the gateway parses cleanly, followed by
  // extra pipelined bytes the gateway's HTTP client discards but the Oracle
  // records: a genuine two-views-of-one-wire divergence, not a fabricated one.
  return Buffer.concat([honestWire(body), Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nevil")]);
}

interface OracleObservation {
  wireBytes: Buffer;
  connectionClosedCleanly: boolean;
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

async function close(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function nextObservation(observations: OracleObservation[], index: number): Promise<OracleObservation> {
  for (let attempt = 0; attempt < 2000 && observations.length <= index; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const observation = observations[index];
  if (!observation) {
    throw new Error(`Oracle never recorded an observation for transit ${index}.`);
  }
  return observation;
}

function receiptFor(responseBody: Buffer, requestDigest: string, responseDigest: string, index: number, secret: string): SignedDecisionReceiptV2 {
  const trace = executionTraceFromTransitRecords([
    {
      schemaVersion: "ghost.gateway_transit.v1",
      statusCode: 200,
      toolName: "fsa-tool",
      sequenceNum: 0,
      requestDigest,
      responseDigest,
      body: responseBody,
      responseEvidence: {
        evidenceId: `evd_${sha256Hex(responseDigest)}`,
        contentDigest: responseDigest,
        sourceId: "fsa-tool",
        provenanceClass: "GATEWAY_RECORDED"
      }
    }
  ]);
  const unsigned = buildUnsignedDecisionReceiptV2({
    request_id: `e2e-request-${index}`,
    tenant_id_hash: privateHmacDigest(secret, "tenant-e2e"),
    user_id_hash: privateHmacDigest(secret, "user-e2e"),
    session_id_hash: privateHmacDigest(secret, "session-e2e"),
    timestamp: "2026-07-15T00:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:e2e@1",
    policy_hash: "d".repeat(64),
    input_digest: publicSha256Digest(`input-${index}`),
    retrieved_context_digests: [],
    execution_context_hash: `sha256:${sha256Hex(`ctx-${index}`)}`,
    execution_nonce: `e2e-nonce-${String(index).padStart(4, "0")}`,
    execution_trace: trace,
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt", "invoke_tool"],
    risk_score: 0,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 5,
    cost_estimate_usd: 0,
    prev_receipt_hash: null,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY"
  });
  return signDecisionReceiptV2(unsigned, new LocalDevHmacReceiptSigner({ secret }));
}

function sealReport(core: Omit<E2EMReport, "provenance_signature">, secret: string): E2EMReport {
  const signer = new LocalDevHmacReceiptSigner({ secret });
  const canonical = canonicalize(core);
  const signature = signer.signCanonical(canonical);
  const provenance_signature = encodeDecisionReceiptSignatureEnvelope({
    schemaVersion: SIGNATURE_ENVELOPE_SCHEMA,
    keyId: signer.keyId,
    algorithm: signer.algorithm,
    digestSha256: sha256Hex(canonical),
    signature
  });
  return { ...core, provenance_signature };
}

export function verifyReportSeal(report: E2EMReport, secret = E2E_DEV_HMAC_SECRET): boolean {
  const { provenance_signature, ...core } = report;
  const canonical = canonicalize(core);
  let envelope;
  try {
    envelope = decodeDecisionReceiptSignatureEnvelope(provenance_signature);
  } catch {
    return false;
  }
  if (envelope.digestSha256 !== sha256Hex(canonical)) {
    return false;
  }
  return new LocalDevHmacReceiptSigner({ secret }).verifyCanonical(canonical, envelope.signature);
}

export async function runE2EFsaHarness(options: E2EHarnessOptions): Promise<E2EMReport> {
  const secret = options.hmacSecret ?? E2E_DEV_HMAC_SECRET;
  const epsilon = options.epsilon ?? 0.01;

  const wireQueue: Buffer[] = FSA_CORPUS.map((scenario, index) => {
    const body = Buffer.from(JSON.stringify({ status: "ok", scenario: scenario.id, index }));
    return scenario.wireMode === "smuggle_trailing" ? smugglingWire(body) : honestWire(body);
  });

  const observations: OracleObservation[] = [];

  const target = net.createServer((socket) => {
    socket.once("data", () => {
      const response = wireQueue.shift() ?? Buffer.from("HTTP/1.1 500 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      socket.end(response);
    });
    socket.on("error", () => undefined);
  });

  let targetPort = 0;
  const proxy = net.createServer((downstream) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    const captured: Buffer[] = [];
    let cleanClose = false;
    downstream.on("data", (chunk: Buffer) => upstream.write(chunk));
    upstream.on("data", (chunk: Buffer) => {
      captured.push(chunk);
      downstream.write(chunk);
    });
    upstream.on("end", () => {
      cleanClose = true;
      observations.push({ wireBytes: Buffer.concat(captured), connectionClosedCleanly: true });
      downstream.end();
    });
    upstream.on("close", () => {
      if (!cleanClose) {
        observations.push({ wireBytes: Buffer.concat(captured), connectionClosedCleanly: false });
        downstream.destroy();
      }
    });
    downstream.on("end", () => upstream.end());
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
  });

  const records: E2EExecutionRecord[] = [];
  const outcomes: ExecutionOutcome[] = [];

  try {
    targetPort = await listen(target);
    const proxyPort = await listen(proxy);
    const proxyDestination = `127.0.0.1:${proxyPort}`;

    for (let index = 0; index < FSA_CORPUS.length; index += 1) {
      const scenario = FSA_CORPUS[index];
      const requestBody = Buffer.from(JSON.stringify({ scenario: scenario.id }));

      const transit = await executeGovernedTransit({
        targetUrl: `http://${proxyDestination}/fsa/execute`,
        toolName: "fsa-tool",
        requestBody,
        sequenceNum: 0,
        allowedDestinations: [proxyDestination]
      });
      const observation = await nextObservation(observations, index);

      const receipt = receiptFor(transit.body, transit.requestDigest, transit.responseDigest, index, secret);
      if (scenario.tamperReceipt) {
        receipt.execution_trace[0].response_payload_digest = `sha256:${sha256Hex(`tampered-${index}`)}`;
      }

      const receiptValid = options.verifyReceiptValid(receipt);
      const reconciliation = reconcileReceiptAgainstOracle(receipt.execution_trace, [
        {
          target: proxyDestination,
          sequenceNum: 0,
          wireBytes: observation.wireBytes,
          connectionClosedCleanly: observation.connectionClosedCleanly
        }
      ]);
      const oracleReconciled = reconciliation.reconciled;

      records.push({
        index,
        scenarioId: scenario.id,
        receiptValid,
        oracleReconciled,
        reconcilerStatus: reconciliation.findings[0]?.status ?? "NO_FINDING"
      });
      outcomes.push({ receiptValid, oracleReconciled });
    }
  } finally {
    await close(proxy).catch(() => undefined);
    await close(target).catch(() => undefined);
  }

  const m_estimate = estimateM(outcomes, { epsilon, confidenceLabel: 0.95 });
  const core: Omit<E2EMReport, "provenance_signature"> = {
    corpus_version: E2E_CORPUS_VERSION,
    epsilon_threshold: epsilon,
    confidence_label: 0.95,
    execution_count: FSA_CORPUS.length,
    m_estimate,
    reconciliation_summary: records,
    sealing_mode: "LOCAL_HMAC_SHA256_DEV_ONLY"
  };
  const report = sealReport(core, secret);

  if (options.outputPath) {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}
