import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  buildUnsignedDecisionReceiptV2,
  canonicalUnsignedDecisionReceiptV2,
  decisionReceiptV2Digest,
  executionTraceFromTransitRecords,
  signDecisionReceiptV2,
  DecisionReceiptV2BuildInput
} from "../../../../../packages/enforcement-runtime/src/receipts/v2/emission";
import { LocalDevHmacReceiptSigner } from "../../../../../packages/enforcement-runtime/src/receipts/signer";
import { publicSha256Digest, privateHmacDigest } from "../../../../../packages/enforcement-runtime/src/receipts/canonical";
import { TransitRecord } from "../../../../../packages/enforcement-runtime/src/gateway/sidecarProxy";

function digest(seed: string): string {
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

function baseInput(overrides: Partial<DecisionReceiptV2BuildInput> = {}): DecisionReceiptV2BuildInput {
  return {
    request_id: "request-v2-1",
    tenant_id_hash: privateHmacDigest("secret", "tenant-a"),
    user_id_hash: privateHmacDigest("secret", "user-a"),
    session_id_hash: privateHmacDigest("secret", "session-a"),
    timestamp: "2026-07-15T12:00:00.000Z",
    model_id: "amazon.titan-text-lite-v1",
    policy_version: "organization:org@1",
    policy_hash: "b".repeat(64),
    input_digest: publicSha256Digest("hello"),
    retrieved_context_digests: [],
    execution_context_hash: digest("exec-context"),
    execution_nonce: "nonce-abcdefgh-01",
    execution_trace: [
      {
        sequence_num: 0,
        tool_name: "PostgresTool",
        request_payload_digest: digest("req-0"),
        response_payload_digest: digest("res-0"),
        provenance_class: "GATEWAY_RECORDED"
      }
    ],
    decision_pre: "ALLOW",
    decision_post: "ALLOW",
    action_taken: ["emit_receipt"],
    risk_score: 0,
    consent_state: "not_required",
    memory_written: false,
    latency_ms: 12,
    cost_estimate_usd: 0,
    prev_receipt_hash: null,
    signature_alg: "LOCAL_HMAC_SHA256_DEV_ONLY",
    ...overrides
  };
}

describe("decision receipt v2 emission", () => {
  it("derives a deterministic grct2 receipt id from the canonical identity payload", () => {
    const a = buildUnsignedDecisionReceiptV2(baseInput());
    const b = buildUnsignedDecisionReceiptV2(baseInput());
    expect(a.receipt_id).toMatch(/^grct2_[a-f0-9]{64}$/u);
    expect(a.receipt_id).toBe(b.receipt_id);
  });

  it("changes identity when a trace response digest changes (record binding)", () => {
    const original = buildUnsignedDecisionReceiptV2(baseInput());
    const tampered = buildUnsignedDecisionReceiptV2(
      baseInput({
        execution_trace: [
          {
            sequence_num: 0,
            tool_name: "PostgresTool",
            request_payload_digest: digest("req-0"),
            response_payload_digest: digest("res-0-TAMPERED"),
            provenance_class: "GATEWAY_RECORDED"
          }
        ]
      })
    );
    expect(tampered.receipt_id).not.toBe(original.receipt_id);
  });

  it("rejects a non-increasing trace sequence", () => {
    expect(() =>
      buildUnsignedDecisionReceiptV2(
        baseInput({
          execution_trace: [
            { sequence_num: 2, tool_name: "T", request_payload_digest: digest("a"), response_payload_digest: digest("b"), provenance_class: "GATEWAY_RECORDED" },
            { sequence_num: 2, tool_name: "T", request_payload_digest: digest("c"), response_payload_digest: digest("d"), provenance_class: "GATEWAY_RECORDED" }
          ]
        })
      )
    ).toThrowError(/strictly increasing/u);
  });

  it("rejects an AGENT_ASSERTED trace class at the schema boundary", () => {
    expect(() =>
      buildUnsignedDecisionReceiptV2(
        baseInput({
          execution_trace: [
            {
              sequence_num: 0,
              tool_name: "T",
              request_payload_digest: digest("a"),
              response_payload_digest: digest("b"),
              provenance_class: "AGENT_ASSERTED" as never
            }
          ]
        })
      )
    ).toThrowError(/assignable non-agent class/u);
  });

  it("signs over the canonical unsigned payload and binds the digest in the envelope", () => {
    const unsigned = buildUnsignedDecisionReceiptV2(baseInput());
    const signer = new LocalDevHmacReceiptSigner({ secret: "dev-secret" });
    const signed = signDecisionReceiptV2(unsigned, signer);
    const envelope = JSON.parse(Buffer.from(signed.receipt_signature, "base64url").toString("utf8"));
    expect(envelope.digestSha256).toBe(decisionReceiptV2Digest(unsigned));
    expect(envelope.algorithm).toBe("LOCAL_HMAC_SHA256_DEV_ONLY");
  });

  it("builds execution_trace from gateway transit records in sequence order", () => {
    const record = (seq: number, tool: string): TransitRecord => ({
      schemaVersion: "ghost.gateway_transit.v1",
      statusCode: 200,
      toolName: tool,
      sequenceNum: seq,
      requestDigest: digest(`req-${seq}`),
      responseDigest: digest(`res-${seq}`),
      body: Buffer.from("{}"),
      responseEvidence: {
        evidenceId: `evd_${"a".repeat(64)}`,
        contentDigest: digest(`res-${seq}`),
        sourceId: tool,
        provenanceClass: "GATEWAY_RECORDED"
      }
    });
    const trace = executionTraceFromTransitRecords([record(2, "B"), record(0, "A"), record(1, "C")]);
    expect(trace.map((entry) => entry.sequence_num)).toEqual([0, 1, 2]);
    expect(trace[0].tool_name).toBe("A");
    expect(canonicalUnsignedDecisionReceiptV2(buildUnsignedDecisionReceiptV2(baseInput({ execution_trace: trace })))).toContain("execution_trace");
  });
});
