import { describe, expect, it } from "vitest";
import {
  MockZkReceiptVerifier,
  type ZkExecutionReceipt,
  validateZkReceiptShape,
} from "../../../packages/research-frontier/src/zkReceipt";

const sha = "a".repeat(64);

function receipt(): ZkExecutionReceipt {
  return {
    schema_version: "ghostark.research.zk_execution_receipt.v1",
    zkvm: "mock",
    guest_image_id: "mock-guest-image-v1",
    public_journal: {
      policy_hash: sha,
      decision_hash: "b".repeat(64),
      prompt_commitment: "c".repeat(64),
      output_commitment: "d".repeat(64),
    },
    proof_reference: {
      type: "inline_mock",
      uri: "mock://proof",
      sha256: "e".repeat(64),
    },
    verification_status: "mock_verified",
  };
}

describe("zk execution receipt interface", () => {
  it("accepts a valid mock zk execution receipt shape", () => {
    expect(() => validateZkReceiptShape(receipt())).not.toThrow();
  });

  it("requires policy hash, decision hash, prompt commitment, and output commitment", () => {
    const r = receipt();
    r.public_journal.prompt_commitment = "bad";

    expect(() => validateZkReceiptShape(r)).toThrow(
      /prompt_commitment must be a lowercase SHA-256 hex digest/i,
    );
  });

  it("mock verifier accepts mock_verified mock receipts", async () => {
    const verifier = new MockZkReceiptVerifier();

    await expect(verifier.verify(receipt())).resolves.toEqual({
      ok: true,
      status: "mock_verified",
    });
  });

  it("mock verifier rejects non-mock zkVM receipts", async () => {
    const verifier = new MockZkReceiptVerifier();
    const r = receipt();
    r.zkvm = "risc0";

    const result = await verifier.verify(r);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/real zkVM verification is not implemented/i);
  });

  it("mock verifier rejects receipts that are not declared mock_verified", async () => {
    const verifier = new MockZkReceiptVerifier();
    const r = receipt();
    r.verification_status = "unverified";

    const result = await verifier.verify(r);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must declare mock_verified/i);
  });
});
