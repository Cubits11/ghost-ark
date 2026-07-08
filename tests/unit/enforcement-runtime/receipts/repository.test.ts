import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";
import {
  buildUnsignedDecisionReceipt,
  privateHmacDigest,
  publicSha256Digest
} from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import { DefaultDecisionReceiptEmitter } from "../../../../packages/enforcement-runtime/src/receipts/emission";
import {
  DecisionReceiptRepository,
  DynamoDbDecisionReceiptRepository,
  IntegrityCollisionError
} from "../../../../packages/enforcement-runtime/src/receipts/repository";
import { InMemoryDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { LocalDevHmacReceiptSigner, signDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { SignedDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/schema";

type CommandWithInput = PutCommand | GetCommand;
type MockDocumentClient = {
  send: ReturnType<typeof vi.fn>;
};

const signer = new LocalDevHmacReceiptSigner({ secret: "receipt-signing-secret" });

function decision(phase: PolicyDecision["phase"], value: PolicyDecision["decision"]): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase,
    decision: value,
    policyVersion: "organization:test@1",
    policyHash: "a".repeat(64),
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: ["test_action"],
    riskScore: 0,
    reasons: ["test"]
  };
}

function signedReceipt(inputDigest = publicSha256Digest("input-a")): SignedDecisionReceipt {
  return signDecisionReceipt(
    buildUnsignedDecisionReceipt({
      request_id: "request-a",
      tenant_id_hash: privateHmacDigest("identity-secret", "tenant-a"),
      user_id_hash: privateHmacDigest("identity-secret", "user-a"),
      session_id_hash: privateHmacDigest("identity-secret", "session-a"),
      timestamp: "2026-07-07T12:00:00.000Z",
      model_id: "anthropic.claude-test",
      policy_version: "organization:test@1",
      policy_hash: "a".repeat(64),
      input_digest: inputDigest,
      retrieved_context_digests: [publicSha256Digest("context-a")],
      decision_pre: "ALLOW",
      decision_post: "REDACT",
      action_taken: ["test_action", "test_action"],
      risk_score: 0,
      consent_state: "not_required",
      memory_written: false,
      latency_ms: 3,
      cost_estimate_usd: 0,
      prev_receipt_hash: null,
      signature_alg: signer.algorithm
    }),
    signer
  );
}

function conditionalCheckFailed(): Error {
  return Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
    $metadata: { httpStatusCode: 400 }
  });
}

function mockClient(handler: (command: CommandWithInput) => Promise<unknown>): MockDocumentClient {
  return {
    send: vi.fn(handler)
  };
}

describe("DynamoDbDecisionReceiptRepository", () => {
  it("initial_write_succeeds", async () => {
    const receipt = signedReceipt();
    const client = mockClient(async () => ({}));
    const repository = new DynamoDbDecisionReceiptRepository({ tableName: "receipts", client: client as never });

    await expect(repository.put(receipt)).resolves.toEqual({
      status: "CREATED",
      receipt,
      persistedAt: receipt.timestamp
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    const putCommand = client.send.mock.calls[0][0];
    expect(putCommand).toBeInstanceOf(PutCommand);
    expect(putCommand.input).toMatchObject({
      TableName: "receipts",
      ConditionExpression: "attribute_not_exists(tenantId) AND attribute_not_exists(receiptId)",
      Item: {
        tenantId: receipt.tenant_id_hash,
        receiptId: receipt.receipt_id,
        receipt,
        persistedAt: receipt.timestamp
      }
    });
  });

  it("idempotent_replay_returns_existing", async () => {
    const receipt = signedReceipt();
    const client = mockClient(async (command) => {
      if (command instanceof PutCommand) {
        throw conditionalCheckFailed();
      }
      return { Item: { receipt, persistedAt: "2026-07-07T12:00:01.000Z" } };
    });
    const repository = new DynamoDbDecisionReceiptRepository({ tableName: "receipts", client: client as never });

    await expect(repository.put(receipt)).resolves.toEqual({
      status: "IDEMPOTENT_EXISTING",
      receipt,
      persistedAt: "2026-07-07T12:00:01.000Z"
    });

    expect(client.send).toHaveBeenCalledTimes(2);
    const getCommand = client.send.mock.calls[1][0];
    expect(getCommand).toBeInstanceOf(GetCommand);
    expect(getCommand.input).toMatchObject({
      TableName: "receipts",
      Key: { tenantId: receipt.tenant_id_hash, receiptId: receipt.receipt_id },
      ConsistentRead: true
    });
  });

  it("collision_tamper_throws", async () => {
    const receipt = signedReceipt();
    const storedReceipt = {
      ...receipt,
      input_digest: publicSha256Digest("tampered-input")
    };
    const client = mockClient(async (command) => {
      if (command instanceof PutCommand) {
        throw conditionalCheckFailed();
      }
      return { Item: { receipt: storedReceipt } };
    });
    const repository = new DynamoDbDecisionReceiptRepository({ tableName: "receipts", client: client as never });

    await expect(repository.put(receipt)).rejects.toThrow(IntegrityCollisionError);
  });

  it("emitter_returns_existing_receipt_without_resigning_replay", async () => {
    const existingReceipt = signedReceipt();
    const signCanonical = vi.fn(() => "new-signature");
    const repository: DecisionReceiptRepository = {
      put: vi.fn(async () => {
        throw new Error("put should not run for an existing deterministic receipt");
      }),
      get: vi.fn(async () => existingReceipt)
    };
    const emitter = new DefaultDecisionReceiptEmitter({
      signer: { keyId: "local-dev-hmac", algorithm: signer.algorithm, signCanonical },
      repository,
      hmacSecret: "identity-secret"
    });

    await expect(
      emitter.emit({
        identity: {
          tenantId: "tenant-a",
          userId: "user-a",
          role: "user",
          sessionId: "session-a",
          requestId: "request-a",
          source: "jwt"
        },
        modelId: "anthropic.claude-test",
        policyVersion: "organization:test@1",
        policyHash: "a".repeat(64),
        inputDigest: publicSha256Digest("input-a"),
        retrievedContextDigests: [publicSha256Digest("context-a")],
        preDecision: decision("pre_model", "ALLOW"),
        postDecision: decision("post_model", "REDACT"),
        memoryWritten: false,
        consentState: "not_required",
        latencyMs: 3,
        timestamp: "2026-07-07T12:00:00.000Z"
      })
    ).resolves.toEqual(existingReceipt);

    expect(signCanonical).not.toHaveBeenCalled();
    expect(repository.put).not.toHaveBeenCalled();
  });
});

describe("InMemoryDecisionReceiptRepository", () => {
  it("returns an idempotent result for exact duplicate receipts", async () => {
    const repository = new InMemoryDecisionReceiptRepository();
    const receipt = signedReceipt();

    await expect(repository.put(receipt)).resolves.toMatchObject({
      status: "CREATED",
      receipt
    });
    await expect(repository.put(receipt)).resolves.toMatchObject({
      status: "IDEMPOTENT_EXISTING",
      receipt
    });
    expect(repository.all()).toHaveLength(1);
  });

  it("fails closed when a duplicate receipt key has different canonical content", async () => {
    const repository = new InMemoryDecisionReceiptRepository();
    const receipt = signedReceipt();
    await repository.put(receipt);

    await expect(repository.put({ ...receipt, input_digest: publicSha256Digest("conflicting-input") })).rejects.toThrow(
      IntegrityCollisionError
    );
    expect(repository.all()).toHaveLength(1);
  });
});
