import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  buildMerkleInclusionProof,
  signEpochCheckpoint,
  verifyMerkleInclusionProof
} from "../../../packages/enforcement-runtime/src/receipts/checkpoint";
import { LocalDevHmacReceiptSigner } from "../../../packages/enforcement-runtime/src/receipts/signer";

function schema(path: string): object {
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

describe("transparency checkpoint artifacts", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateCheckpoint = ajv.compile(schema("schemas/receipt-checkpoint.json"));
  const validateInclusionProof = ajv.compile(schema("schemas/receipt-inclusion-proof.json"));
  const leaves = [
    {
      tenantId: `hmac-sha256:${"a".repeat(64)}`,
      headHash: `sha256:${"1".repeat(64)}`
    },
    {
      tenantId: `hmac-sha256:${"b".repeat(64)}`,
      headHash: `sha256:${"2".repeat(64)}`
    }
  ];

  it("validates generated signed checkpoints and inclusion proofs against the public schemas", async () => {
    const signer = new LocalDevHmacReceiptSigner({ keyId: "local-checkpoint-test", secret: "test-only-secret" });
    const checkpoint = await signEpochCheckpoint({
      epochId: "epoch-local-schema-test",
      createdAt: "2026-07-09T12:00:00.000Z",
      leaves,
      signer
    });
    const proof = buildMerkleInclusionProof(leaves, leaves[0]);

    expect(validateCheckpoint(checkpoint), JSON.stringify(validateCheckpoint.errors)).toBe(true);
    expect(validateInclusionProof(proof), JSON.stringify(validateInclusionProof.errors)).toBe(true);
    expect(proof.root).toBe(checkpoint.merkleRoot);
    expect(verifyMerkleInclusionProof(proof, checkpoint.merkleRoot)).toBe(true);
  });

  it("rejects malformed digests and undeclared fields", () => {
    const proof = {
      ...buildMerkleInclusionProof(leaves, leaves[0]),
      root: "not-a-digest",
      undeclared: true
    };

    expect(validateInclusionProof(proof)).toBe(false);
    expect(validateInclusionProof.errors?.map((error) => error.keyword)).toEqual(
      expect.arrayContaining(["additionalProperties", "pattern"])
    );
  });
});
