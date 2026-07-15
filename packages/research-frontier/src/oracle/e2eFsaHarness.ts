import * as net from "net";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { canonicalize, sha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { executeGovernedTransit, TransitRecord } from "../../../enforcement-runtime/src/gateway/sidecarProxy";
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
import { OracleTransitObservation, reconcileReceiptAgainstOracle } from "./byteReconciler";
import { estimateM, ExecutionOutcome, MEstimate } from "./mEstimator";

/**
 * End-to-end M-measurement harness (research-only, local, zero cloud).
 *
 * Every number in the sealed report flows from a real event. The FSA request
 * transits the REAL gateway (executeGovernedTransit) over real TCP; the
 * IODigester hashes the decoded body it actually received; the v2 receipt is
 * built and signed by the REAL emission path (content-derived grct2 id,
 * hardened canonicalizer, real signer envelope); receiptValid comes from an
 * injected REAL v2 verifier; oracleReconciled comes from the REAL byte
 * reconciler over bytes captured by a transparent tee proxy the gateway holds
 * no reference to; M comes from the REAL estimator under a pre-registered
 * epsilon. No randomUUID, no ad-hoc key-sort stringify, no reimplemented
 * verifier/reconciler/estimator.
 *
 * Empirical finding encoded here: a strict HTTP client (the gateway) REJECTS
 * trailing-byte response smuggling ("Parse Error: Data after Connection:
 * close") and fails closed — so wire smuggling does not produce a
 * receipt-valid divergence; it is PREVENTED, not silent. The silent-compromise
 * class that actually contributes to M is an UNRECORDED egress: a real call the
 * agent makes that the receipt omits and the Oracle observes.
 *
 * The pipeline is deterministic (fixed secret, fixed timestamps, no randomUUID,
 * no wall-clock waits): two runs produce a byte-identical sealed report, which
 * the integration test asserts.
 *
 * Non-claims: not a cloud run; not field behavior of a live agent;
 * governedInvoke does not emit v2 receipts yet; M here is over a synthetic
 * corpus, not a field rate.
 */

export const E2E_DEV_HMAC_SECRET = "ghost-ark-e2e-fsa-harness-dev-only";
export const E2E_CORPUS_VERSION = "fsa-local-v1";
const SIGNATURE_ENVELOPE_SCHEMA = "ghost.decision_receipt_signature.v1" as const;

type ScenarioKind = "honest" | "side_channel" | "smuggle_prevented" | "tamper";

interface FsaScenario {
  id: string;
  kind: ScenarioKind;
}

const FSA_CORPUS: readonly FsaScenario[] = [
  { id: "honest-0", kind: "honest" },
  { id: "honest-1", kind: "honest" },
  { id: "honest-2", kind: "honest" },
  { id: "honest-3", kind: "honest" },
  { id: "side-channel-0", kind: "side_channel" },
  { id: "side-channel-1", kind: "side_channel" },
  { id: "smuggle-prevented-0", kind: "smuggle_prevented" },
  { id: "tampered-receipt-0", kind: "tamper" }
];

export interface E2EExecutionRecord {
  index: number;
  scenarioId: string;
  kind: ScenarioKind;
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

interface OracleObservation {
  wireBytes: Buffer;
  connectionClosedCleanly: boolean;
}

function honestWire(body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`),
    body
  ]);
}

function smugglingWire(body: Buffer): Buffer {
  // Valid Content-Length response followed by a smuggled request line. A strict
  // HTTP client rejects the trailing bytes and fails closed; the Oracle still
  // captures them. This is the case the harness proves is PREVENTED, not silent.
  return Buffer.concat([honestWire(body), Buffer.from("\r\nGET /internal HTTP/1.1\r\n\r\n")]);
}

function extractSeq(buffer: Buffer): number | null {
  const match = buffer.toString("latin1").match(/"seq":(\d+)/u);
  return match ? Number(match[1]) : null;
}

async function listen(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

async function close(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function awaitObservation(observations: Map<number, OracleObservation>, seq: number): Promise<OracleObservation> {
  for (let attempt = 0; attempt < 5000 && !observations.has(seq); attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const observation = observations.get(seq);
  if (!observation) {
    throw new Error(`Oracle never recorded an observation for transit seq ${seq}.`);
  }
  return observation;
}

function receiptFor(transit: TransitRecord, index: number, secret: string): SignedDecisionReceiptV2 {
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
    execution_trace: executionTraceFromTransitRecords([transit]),
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

function summarizeStatus(statuses: string[]): string {
  const divergent = statuses.find((status) => status !== "MATCH");
  return divergent ?? "MATCH";
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

  const observations = new Map<number, OracleObservation>();
  const responseBySeq = new Map<number, Buffer>();
  let seqCounter = 0;

  const target = net.createServer((socket) => {
    let request = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      request = Buffer.concat([request, chunk]);
      const seq = extractSeq(request);
      if (seq !== null) {
        socket.off("data", onData);
        socket.end(responseBySeq.get(seq) ?? Buffer.from("HTTP/1.1 500 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
      }
    };
    socket.on("data", onData);
    socket.on("error", () => undefined);
  });

  let targetPort = 0;
  const proxy = net.createServer((downstream) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    const captured: Buffer[] = [];
    let request = Buffer.alloc(0);
    let seq: number | null = null;
    let recorded = false;
    const record = (clean: boolean): void => {
      if (!recorded && seq !== null) {
        recorded = true;
        observations.set(seq, { wireBytes: Buffer.concat(captured), connectionClosedCleanly: clean });
      }
    };
    downstream.on("data", (chunk: Buffer) => {
      if (seq === null) {
        request = Buffer.concat([request, chunk]);
        seq = extractSeq(request);
      }
      upstream.write(chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      captured.push(chunk);
      downstream.write(chunk);
    });
    upstream.on("end", () => {
      record(true);
      downstream.end();
    });
    upstream.on("close", () => {
      record(false);
      downstream.destroy();
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

    // One real gateway transit. `smuggle` responses make a strict client fail
    // closed. `seq` is the wire-correlation index (used to fetch the Oracle
    // observation); it is kept separate from the receipt trace's sequence_num,
    // which stays 0 for a single-call receipt.
    const transit = async (wireMode: "honest" | "smuggle"): Promise<{ record: TransitRecord; seq: number } | null> => {
      const seq = seqCounter;
      seqCounter += 1;
      const responseBody = Buffer.from(JSON.stringify({ status: "ok", seq }));
      responseBySeq.set(seq, wireMode === "smuggle" ? smugglingWire(responseBody) : honestWire(responseBody));
      try {
        const record = await executeGovernedTransit({
          targetUrl: `http://${proxyDestination}/fsa/execute`,
          toolName: "fsa-tool",
          requestBody: Buffer.from(JSON.stringify({ seq, marker: "fsa" })),
          sequenceNum: 0,
          allowedDestinations: [proxyDestination]
        });
        return { record, seq };
      } catch {
        return null; // gateway failed closed (parse error on smuggled bytes)
      }
    };

    for (let index = 0; index < FSA_CORPUS.length; index += 1) {
      const scenario = FSA_CORPUS[index];

      if (scenario.kind === "smuggle_prevented") {
        const rejected = (await transit("smuggle")) === null;
        const receiptValid = false;
        records.push({
          index,
          scenarioId: scenario.id,
          kind: scenario.kind,
          receiptValid,
          oracleReconciled: false,
          reconcilerStatus: rejected ? "PREVENTED_FAIL_CLOSED" : "UNEXPECTED_SMUGGLE_ACCEPTED"
        });
        outcomes.push({ receiptValid, oracleReconciled: false });
        continue;
      }

      const governed = await transit("honest");
      if (!governed) {
        throw new Error(`Honest transit for ${scenario.id} unexpectedly failed closed.`);
      }
      const governedObservation = await awaitObservation(observations, governed.seq);
      const receipt = receiptFor(governed.record, index, secret);

      const reconcileObservations: OracleTransitObservation[] = [
        {
          target: proxyDestination,
          sequenceNum: 0,
          wireBytes: governedObservation.wireBytes,
          connectionClosedCleanly: governedObservation.connectionClosedCleanly
        }
      ];

      if (scenario.kind === "side_channel") {
        // A second REAL egress the receipt does not record: silent compromise.
        const covert = await transit("honest");
        if (!covert) {
          throw new Error(`Covert transit for ${scenario.id} unexpectedly failed closed.`);
        }
        const covertObservation = await awaitObservation(observations, covert.seq);
        reconcileObservations.push({
          target: proxyDestination,
          sequenceNum: 1, // no matching receipt trace entry -> UNRECORDED_TRANSIT
          wireBytes: covertObservation.wireBytes,
          connectionClosedCleanly: covertObservation.connectionClosedCleanly
        });
      }

      if (scenario.kind === "tamper") {
        receipt.execution_trace[0].response_payload_digest = `sha256:${sha256Hex(`tampered-${index}`)}`;
      }

      const receiptValid = options.verifyReceiptValid(receipt);
      const reconciliation = reconcileReceiptAgainstOracle(receipt.execution_trace, reconcileObservations);
      const reconcilerStatus = summarizeStatus(reconciliation.findings.map((finding) => finding.status));

      records.push({
        index,
        scenarioId: scenario.id,
        kind: scenario.kind,
        receiptValid,
        oracleReconciled: reconciliation.reconciled,
        reconcilerStatus
      });
      outcomes.push({ receiptValid, oracleReconciled: reconciliation.reconciled });
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
