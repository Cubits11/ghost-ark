import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE_ROOT,
  computeMerkleRoot,
  leafHash,
  nodeHash,
} from "../../../packages/research-frontier/src/merkle";
import {
  canonicalCheckpointPayload,
  createWitnessCheckpointConsistencyProof,
  createDevWitnessKeyPair,
  createWitnessCheckpoint,
  type WitnessKeyManifest,
  validateWitnessKeyManifestSemantics,
  verifyCheckpointSignature,
  verifyWitnessCheckpointSignaturesWithManifest,
  verifyWitnessKeyManifestEpoch,
  verifyWitnessCheckpointConsistencyProof,
} from "../../../packages/research-frontier/src/witnessCheckpoint";

describe("research frontier Merkle and local witness checkpoint primitives", () => {
  it("computes a stable empty tree root", () => {
    expect(computeMerkleRoot([])).toBe(EMPTY_TREE_ROOT);
    expect(EMPTY_TREE_ROOT).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computes deterministic roots for the same payload sequence", () => {
    const payloads = ["receipt-a", "receipt-b", "receipt-c"];

    expect(computeMerkleRoot(payloads)).toBe(computeMerkleRoot(payloads));
  });

  it("changes the root when a payload changes", () => {
    const rootA = computeMerkleRoot(["receipt-a", "receipt-b"]);
    const rootB = computeMerkleRoot(["receipt-a", "receipt-x"]);

    expect(rootA).not.toBe(rootB);
  });

  it("changes the root when a payload is appended", () => {
    const rootA = computeMerkleRoot(["receipt-a", "receipt-b"]);
    const rootB = computeMerkleRoot(["receipt-a", "receipt-b", "receipt-c"]);

    expect(rootA).not.toBe(rootB);
  });

  it("uses explicit domain separation for leaves and nodes", () => {
    const left = leafHash("left");
    const right = leafHash("right");
    const parent = nodeHash(left, right);

    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(right).toMatch(/^[a-f0-9]{64}$/);
    expect(parent).toMatch(/^[a-f0-9]{64}$/);
    expect(parent).not.toBe(left);
    expect(parent).not.toBe(right);
  });

  it("rejects invalid node hash inputs", () => {
    expect(() => nodeHash("not-a-hash", leafHash("right"))).toThrow(
      /leftHex must be a lowercase SHA-256 hex digest/i,
    );
  });

  it("formats checkpoint payloads with a stable key order", () => {
    const payload = canonicalCheckpointPayload({
      schema_version: "ghostark.research.witness_checkpoint.v1",
      log_id: "ghost-ark-dev-log",
      tree_size: 1,
      root_hash: "b".repeat(64),
      integrated_time: "2026-07-08T23:30:00.000Z",
    });

    expect(payload).toBe(
      JSON.stringify({
        integrated_time: "2026-07-08T23:30:00.000Z",
        log_id: "ghost-ark-dev-log",
        root_hash: "b".repeat(64),
        schema_version: "ghostark.research.witness_checkpoint.v1",
        tree_size: 1,
      }),
    );
  });

  it("creates and verifies a local dev witness-signed checkpoint", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");

    const checkpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });

    const payload = canonicalCheckpointPayload({
      schema_version: checkpoint.schema_version,
      log_id: checkpoint.log_id,
      tree_size: checkpoint.tree_size,
      root_hash: checkpoint.root_hash,
      integrated_time: checkpoint.integrated_time,
    });

    expect(checkpoint.schema_version).toBe(
      "ghostark.research.witness_checkpoint.v1",
    );
    expect(checkpoint.tree_size).toBe(2);
    expect(checkpoint.root_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(checkpoint.witness_signatures).toHaveLength(1);
    expect(
      verifyCheckpointSignature({
        payload,
        signature: checkpoint.witness_signatures[0].signature,
        publicKeyPem: witness.publicKeyPem,
      }),
    ).toBe(true);
  });

  it("rejects a tampered checkpoint payload signature", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");

    const checkpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });

    const tamperedPayload = canonicalCheckpointPayload({
      schema_version: checkpoint.schema_version,
      log_id: checkpoint.log_id,
      tree_size: checkpoint.tree_size,
      root_hash: "a".repeat(64),
      integrated_time: checkpoint.integrated_time,
    });

    expect(
      verifyCheckpointSignature({
        payload: tamperedPayload,
        signature: checkpoint.witness_signatures[0].signature,
        publicKeyPem: witness.publicKeyPem,
      }),
    ).toBe(false);
  });

  it("verifies checkpoint signatures with a witness key manifest", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");
    const checkpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });
    const manifest: WitnessKeyManifest = {
      schema_version: "ghostark.research.witness_key_manifest.v1",
      generated_at: "2026-07-08T23:00:00.000Z",
      witnesses: [
        {
          witness_id: witness.witnessId,
          signature_algorithm: "ecdsa-p256-sha256",
          public_key_pem: witness.publicKeyPem,
          valid_from: "2026-07-08T00:00:00.000Z",
          status: "ACTIVE",
        },
      ],
    };

    expect(validateWitnessKeyManifestSemantics(manifest)).toBeUndefined();
    expect(
      verifyWitnessCheckpointSignaturesWithManifest({
        checkpoint,
        manifest,
      }),
    ).toBe(true);
  });

  it("rejects checkpoint signatures when the witness manifest has the wrong key", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");
    const wrongWitness = createDevWitnessKeyPair("dev-witness-1");
    const checkpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });

    expect(
      verifyWitnessCheckpointSignaturesWithManifest({
        checkpoint,
        manifest: {
          schema_version: "ghostark.research.witness_key_manifest.v1",
          generated_at: "2026-07-08T23:00:00.000Z",
          witnesses: [
            {
              witness_id: witness.witnessId,
              signature_algorithm: "ecdsa-p256-sha256",
              public_key_pem: wrongWitness.publicKeyPem,
              valid_from: "2026-07-08T00:00:00.000Z",
              status: "ACTIVE",
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects witness manifest epochs outside the checkpoint time", () => {
    const manifest: WitnessKeyManifest = {
      schema_version: "ghostark.research.witness_key_manifest.v1",
      generated_at: "2026-07-08T23:00:00.000Z",
      witnesses: [
        {
          witness_id: "dev-witness-1",
          signature_algorithm: "ecdsa-p256-sha256",
          public_key_pem: "-----BEGIN PUBLIC KEY-----\nplaceholder\n-----END PUBLIC KEY-----\n",
          valid_from: "2026-07-08T00:00:00.000Z",
          valid_until: "2026-07-08T23:00:00.000Z",
          status: "REVOKED",
          revoked_at: "2026-07-08T23:15:00.000Z",
        },
      ],
    };

    expect(
      verifyWitnessKeyManifestEpoch({
        manifest,
        witnessId: "dev-witness-1",
        signatureAlgorithm: "ecdsa-p256-sha256",
        integratedTime: "2026-07-08T23:30:00.000Z",
      }),
    ).toMatchObject({ passed: false });
  });

  it("rejects duplicate witness manifest entries and inverted windows", () => {
    const duplicateManifest: WitnessKeyManifest = {
      schema_version: "ghostark.research.witness_key_manifest.v1",
      generated_at: "2026-07-08T23:00:00.000Z",
      witnesses: [
        {
          witness_id: "dev-witness-1",
          signature_algorithm: "ecdsa-p256-sha256",
          public_key_pem: "public-key-a",
          valid_from: "2026-07-08T00:00:00.000Z",
          status: "ACTIVE",
        },
        {
          witness_id: "dev-witness-1",
          signature_algorithm: "ecdsa-p256-sha256",
          public_key_pem: "public-key-b",
          valid_from: "2026-07-08T01:00:00.000Z",
          status: "DEPRECATED",
        },
      ],
    };
    const invertedWindowManifest: WitnessKeyManifest = {
      schema_version: "ghostark.research.witness_key_manifest.v1",
      generated_at: "2026-07-08T23:00:00.000Z",
      witnesses: [
        {
          witness_id: "dev-witness-1",
          signature_algorithm: "ecdsa-p256-sha256",
          public_key_pem: "public-key-a",
          valid_from: "2026-07-09T00:00:00.000Z",
          valid_until: "2026-07-08T00:00:00.000Z",
          status: "ACTIVE",
        },
      ],
    };

    expect(() => validateWitnessKeyManifestSemantics(duplicateManifest)).toThrow(
      /duplicate/i,
    );
    expect(() =>
      validateWitnessKeyManifestSemantics(invertedWindowManifest),
    ).toThrow(/valid_until/i);
  });

  it("creates and verifies checkpoint consistency proof bundles", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");
    const previousCheckpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });
    const receiptPayloads = [
      "receipt-a",
      "receipt-b",
      "receipt-c",
      "receipt-d",
    ];
    const newCheckpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads,
      integratedTime: "2026-07-08T23:31:00.000Z",
      witness,
    });

    const proof = createWitnessCheckpointConsistencyProof({
      previousCheckpoint,
      newCheckpoint,
      receiptPayloads,
    });

    expect(proof.schema_version).toBe(
      "ghostark.research.witness_checkpoint_consistency_proof.v1",
    );
    expect(proof.old_tree_size).toBe(2);
    expect(proof.new_tree_size).toBe(4);
    expect(proof.old_root_hash).toBe(previousCheckpoint.root_hash);
    expect(proof.new_root_hash).toBe(newCheckpoint.root_hash);
    expect(
      verifyWitnessCheckpointConsistencyProof({
        previousCheckpoint,
        newCheckpoint,
        proof,
      }),
    ).toBe(true);
  });

  it("rejects checkpoint consistency proofs across split views", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");
    const previousCheckpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });
    const newCheckpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b", "receipt-c"],
      integratedTime: "2026-07-08T23:31:00.000Z",
      witness,
    });
    const proof = createWitnessCheckpointConsistencyProof({
      previousCheckpoint,
      newCheckpoint,
      receiptPayloads: ["receipt-a", "receipt-b", "receipt-c"],
    });

    expect(
      verifyWitnessCheckpointConsistencyProof({
        previousCheckpoint: {
          ...previousCheckpoint,
          root_hash: computeMerkleRoot(["receipt-x", "receipt-y"]),
        },
        newCheckpoint,
        proof,
      }),
    ).toBe(false);
    expect(
      verifyWitnessCheckpointConsistencyProof({
        previousCheckpoint,
        newCheckpoint: {
          ...newCheckpoint,
          log_id: "other-log",
        },
        proof,
      }),
    ).toBe(false);
    expect(
      verifyWitnessCheckpointConsistencyProof({
        previousCheckpoint,
        newCheckpoint,
        proof: {
          ...proof,
          audit_path: [...proof.audit_path, leafHash("extra")],
        },
      }),
    ).toBe(false);
  });

  it("refuses to create consistency proofs for non-prefix checkpoints", () => {
    const witness = createDevWitnessKeyPair("dev-witness-1");
    const previousCheckpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-b"],
      integratedTime: "2026-07-08T23:30:00.000Z",
      witness,
    });
    const newCheckpoint = createWitnessCheckpoint({
      logId: "ghost-ark-dev-log",
      receiptPayloads: ["receipt-a", "receipt-x", "receipt-c"],
      integratedTime: "2026-07-08T23:31:00.000Z",
      witness,
    });

    expect(() =>
      createWitnessCheckpointConsistencyProof({
        previousCheckpoint,
        newCheckpoint,
        receiptPayloads: ["receipt-a", "receipt-x", "receipt-c"],
      }),
    ).toThrow(/not a prefix/i);
  });
});
