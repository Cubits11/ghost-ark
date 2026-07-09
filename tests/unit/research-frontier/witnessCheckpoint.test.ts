import { describe, expect, it } from "vitest";
import {
  EMPTY_TREE_ROOT,
  computeMerkleRoot,
  leafHash,
  nodeHash,
} from "../../../packages/research-frontier/src/merkle";
import {
  canonicalCheckpointPayload,
  createDevWitnessKeyPair,
  createWitnessCheckpoint,
  verifyCheckpointSignature,
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
});
