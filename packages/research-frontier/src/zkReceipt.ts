export type ZkVmKind = "risc0" | "sp1" | "mock";

export type ZkVerificationStatus =
  | "unverified"
  | "mock_verified"
  | "cryptographically_verified"
  | "failed";

export interface ZkExecutionReceipt {
  schema_version: "ghostark.research.zk_execution_receipt.v1";
  zkvm: ZkVmKind;
  guest_image_id: string;
  public_journal: {
    policy_hash: string;
    decision_hash: string;
    prompt_commitment: string;
    output_commitment: string;
  };
  proof_reference: {
    type: "local_file" | "s3_object" | "artifact_registry" | "inline_mock";
    uri: string;
    sha256: string;
  };
  verification_status: ZkVerificationStatus;
}

export interface ZkVerificationResult {
  ok: boolean;
  status: ZkVerificationStatus;
  reason?: string;
}

export interface ZkReceiptVerifier {
  verify(receipt: ZkExecutionReceipt): Promise<ZkVerificationResult>;
}

export function assertSha256Hex(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
}

export function validateZkReceiptShape(receipt: ZkExecutionReceipt): void {
  if (receipt.schema_version !== "ghostark.research.zk_execution_receipt.v1") {
    throw new Error("Invalid zk execution receipt schema version");
  }

  if (!["risc0", "sp1", "mock"].includes(receipt.zkvm)) {
    throw new Error(`Unsupported zkVM kind: ${receipt.zkvm}`);
  }

  if (!receipt.guest_image_id) {
    throw new Error("zk receipt guest_image_id is required");
  }

  assertSha256Hex(receipt.public_journal.policy_hash, "policy_hash");
  assertSha256Hex(receipt.public_journal.decision_hash, "decision_hash");
  assertSha256Hex(
    receipt.public_journal.prompt_commitment,
    "prompt_commitment",
  );
  assertSha256Hex(
    receipt.public_journal.output_commitment,
    "output_commitment",
  );
  assertSha256Hex(receipt.proof_reference.sha256, "proof_reference.sha256");

  if (!receipt.proof_reference.uri) {
    throw new Error("zk receipt proof_reference.uri is required");
  }
}

export class MockZkReceiptVerifier implements ZkReceiptVerifier {
  async verify(receipt: ZkExecutionReceipt): Promise<ZkVerificationResult> {
    try {
      validateZkReceiptShape(receipt);
    } catch (error) {
      return {
        ok: false,
        status: "failed",
        reason: error instanceof Error ? error.message : "unknown error",
      };
    }

    if (receipt.zkvm !== "mock") {
      return {
        ok: false,
        status: "failed",
        reason:
          "Mock verifier only verifies mock receipts; real zkVM verification is not implemented.",
      };
    }

    if (receipt.verification_status !== "mock_verified") {
      return {
        ok: false,
        status: "failed",
        reason: "Mock receipt must declare mock_verified status.",
      };
    }

    return {
      ok: true,
      status: "mock_verified",
    };
  }
}
