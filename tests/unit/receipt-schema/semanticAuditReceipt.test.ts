import { describe, it, expect } from "vitest";
import { evaluateSemanticGate, validateSemanticAuditReceipt } from "../../../packages/receipt-schema/src/semanticAuditReceipt";

describe("SemanticGate & SemanticAuditReceipt validation", () => {
  it("should calculate cumulative failure bounds and trigger FAILED_DRIFT_BOUNDS on A-CC payload", () => {
    const stepProbabilities = [0.05, 0.65, 0.80]; // A-CC severity probabilities
    const policyThreshold = 0.50; // Maximum acceptable failure rate

    const result = evaluateSemanticGate(stepProbabilities, policyThreshold);

    expect(result.cumulative_failure_bound).toBe(1.0); // 0.05 + 0.65 + 0.80 = 1.50, capped at 1.0
    expect(result.status).toBe("FAILED_DRIFT_BOUNDS");
  });

  it("should pass semantic gate when cumulative drift is below threshold", () => {
    const stepProbabilities = [0.05, 0.10, 0.15];
    const policyThreshold = 0.50;

    const result = evaluateSemanticGate(stepProbabilities, policyThreshold);

    expect(result.cumulative_failure_bound).toBeCloseTo(0.30);
    expect(result.status).toBe("PASSED");
  });

  it("should validate a complete SemanticAuditReceipt", () => {
    const receipt = {
      transaction_id: "018b4f1b-3f01-7d1a-9bc0-c1777ab8490b", // Valid UUIDv7 format
      timestamp: new Date().toISOString(),
      agent_identity: {
        principal_arn: "arn:aws:iam::123456789012:role/agent-role",
        model_version: "anthropic.claude-3-5-sonnet-20241022-v2"
      },
      trace_length: 3,
      validation_gates: {
        ledger_gate: {
          status: "PASSED",
          consumed_nonces: ["nonce-123", "nonce-456"]
        },
        occ_gate: {
          status: "PASSED",
          read_set_projection_pi_R: ["s3://acme-lab/config.json"],
          hash_sigma_0: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          hash_sigma_now: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
        },
        semantic_gate: {
          status: "FAILED_DRIFT_BOUNDS",
          step_probabilities: [0.05, 0.65, 0.80],
          cumulative_failure_bound: 1.0,
          policy_threshold: 0.50
        }
      },
      commit_status: "SPECULATIVE_COLLAPSE",
      cryptographic_signature: "sig_bytes_here"
    };

    const validated = validateSemanticAuditReceipt(receipt);
    expect(validated.commit_status).toBe("SPECULATIVE_COLLAPSE");
    expect(validated.validation_gates.semantic_gate.status).toBe("FAILED_DRIFT_BOUNDS");
  });
});
