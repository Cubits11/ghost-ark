import { describe, expect, it } from "vitest";

import {
  DEFAULT_DECISION_RECEIPT_HMAC_SECRET,
  DefaultDecisionReceiptEmitter,
  type DecisionReceiptAsyncSigner,
  type DecisionReceiptEmissionInput
} from "../../../../packages/enforcement-runtime/src/receipts/emission";
import {
  ChainHeadConflictError,
  IntegrityCollisionError,
  type DecisionReceiptRepository
} from "../../../../packages/enforcement-runtime/src/receipts/repository";
import { publicSha256Digest } from "../../../../packages/enforcement-runtime/src/receipts/canonical";
import type { SignedDecisionReceipt } from "../../../../packages/enforcement-runtime/src/receipts/schema";
import type { PolicyDecision } from "../../../../packages/enforcement-runtime/src/policy/decisions";

/**
 * Branch tests for decision-receipt emission, written against experiment E10's
 * report.
 *
 * `emission.ts` scored 56.3% covered (94/167), with **43 of its 210 mutants
 * executed by no test at all**. As in `kmsVerifier.ts`, the unreached code is
 * not incidental — it is every guard the emitter has:
 *
 *   - the signer and input validators (`assertSigner`, `assertEmissionInput`,
 *     `assertNonEmpty`, `assertSignatureShape`), which between them own roughly
 *     half the uncovered lines;
 *   - `IntegrityCollisionError`, raised when a replay lookup finds a stored
 *     receipt whose canonical digest disagrees with the one being emitted;
 *   - `ChainHeadConflictError` and the bounded retry around it;
 *   - the throw when a KMS signer exposes a mutable alias `keyId` **after**
 *     signing, which is the post-hoc half of the immutable-key-ARN rule
 *     `CLAUDE.md` states as a hard requirement.
 *
 * The existing suite emits receipts successfully. Nothing established that
 * malformed input, a colliding digest, or an alias-bearing signer is refused —
 * and an emitter that accepts anything passes every happy-path test.
 */

const PERSISTED_AT = "2026-07-07T12:00:00.000Z";

const VALID_KEY_ID = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-00000000000a";

function decision(
  phase: PolicyDecision["phase"],
  value: PolicyDecision["decision"],
  riskScore = 0
): PolicyDecision {
  return {
    schemaVersion: "ghost.policy.decision.v1",
    phase,
    decision: value,
    policyVersion: "organization:test@1",
    policyHash: "a".repeat(64),
    matchedRuleIds: [],
    matchedLayers: [],
    actionTaken: ["emit_receipt"],
    riskScore,
    reasons: ["test"]
  };
}

function hmacSigner(overrides: Partial<DecisionReceiptAsyncSigner> = {}): DecisionReceiptAsyncSigner {
  return {
    algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY",
    keyId: "local-dev-hmac",
    signCanonical: async () => Buffer.from("a-signature").toString("base64"),
    ...overrides
  } as DecisionReceiptAsyncSigner;
}

function emissionInput(overrides: Partial<DecisionReceiptEmissionInput> = {}): DecisionReceiptEmissionInput {
  return {
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
    inputDigest: publicSha256Digest("hello"),
    retrievedContextDigests: [],
    preDecision: decision("pre_model", "ALLOW"),
    postDecision: decision("post_model", "ALLOW"),
    memoryWritten: false,
    consentState: "not_required",
    latencyMs: 3,
    timestamp: "2026-07-07T12:00:00.000Z",
    ...overrides
  } as DecisionReceiptEmissionInput;
}

function emitter(options: Partial<{ signer: DecisionReceiptAsyncSigner; repository: DecisionReceiptRepository; hmacSecret: string }> = {}) {
  return new DefaultDecisionReceiptEmitter({
    // `"signer" in options` rather than `??`, so a test can pass null/undefined
    // deliberately and reach assertSigner instead of being handed the default.
    signer: "signer" in options ? (options.signer as DecisionReceiptAsyncSigner) : hmacSigner(),
    repository: options.repository,
    hmacSecret: options.hmacSecret ?? "identity-secret"
  });
}

describe("emission: the signer is validated before anything is signed", () => {
  it("emits successfully with a well-formed signer", async () => {
    // The control arm for this whole file.
    const receipt = await emitter().emit(emissionInput());
    expect(receipt.receipt_signature).toBeTruthy();
    expect(receipt.tenant_id_hash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
  });

  it("rejects a non-object signer", () => {
    expect(() => emitter({ signer: null as unknown as DecisionReceiptAsyncSigner })).toThrow(/signer must be an object/u);
    expect(() => emitter({ signer: "signer" as unknown as DecisionReceiptAsyncSigner })).toThrow(/signer must be an object/u);
  });

  it("rejects an empty or non-string signer keyId", () => {
    expect(() => emitter({ signer: hmacSigner({ keyId: "" }) })).toThrow(/keyId must be non-empty/u);
    expect(() => emitter({ signer: hmacSigner({ keyId: 7 as unknown as string }) })).toThrow(/keyId must be non-empty/u);
  });

  it("rejects an unsupported signing algorithm", () => {
    expect(() =>
      emitter({ signer: hmacSigner({ algorithm: "ROT13" as unknown as DecisionReceiptAsyncSigner["algorithm"] }) })
    ).toThrow(/Unsupported decision receipt signer algorithm/u);
  });

  it("rejects a signer that cannot sign", () => {
    expect(() =>
      emitter({ signer: hmacSigner({ signCanonical: undefined as unknown as DecisionReceiptAsyncSigner["signCanonical"] }) })
    ).toThrow(/must expose signCanonical/u);
  });

  it("rejects an empty HMAC secret but accepts the default", () => {
    expect(() => emitter({ hmacSecret: "" })).toThrow(/HMAC secret must be non-empty/u);
    expect(() => new DefaultDecisionReceiptEmitter({ signer: hmacSigner() })).not.toThrow();
    expect(DEFAULT_DECISION_RECEIPT_HMAC_SECRET.length).toBeGreaterThan(0);
  });
});

describe("emission: input is validated before a receipt exists", () => {
  const required: ReadonlyArray<[string, DecisionReceiptEmissionInput]> = [
    ["identity.tenantId", emissionInput({ identity: { ...emissionInput().identity, tenantId: "" } } as never)],
    ["identity.userId", emissionInput({ identity: { ...emissionInput().identity, userId: "" } } as never)],
    ["identity.sessionId", emissionInput({ identity: { ...emissionInput().identity, sessionId: "" } } as never)],
    ["identity.requestId", emissionInput({ identity: { ...emissionInput().identity, requestId: "" } } as never)],
    ["modelId", emissionInput({ modelId: "" })],
    ["policyVersion", emissionInput({ policyVersion: "" })],
    ["policyHash", emissionInput({ policyHash: "" })],
    ["timestamp", emissionInput({ timestamp: "" })]
  ];

  for (const [field, input] of required) {
    it(`rejects an empty ${field} and names the field`, async () => {
      // The field name in the message is asserted because `assertNonEmpty` takes
      // it as a parameter: a mutant that passed the wrong name would otherwise
      // survive, and a validation error that misidentifies the field sends the
      // next reader to the wrong place.
      await expect(emitter().emit(input)).rejects.toThrow(new RegExp(`${field.replace(".", "\\.")} must be a non-empty string`, "u"));
    });
  }

  it("rejects an unparseable timestamp", async () => {
    await expect(emitter().emit(emissionInput({ timestamp: "not-a-date" }))).rejects.toThrow(/timestamp is not parseable/u);
  });

  it("rejects a malformed inputDigest but allows it to be absent", async () => {
    await expect(emitter().emit(emissionInput({ inputDigest: "sha256:zzzz" }))).rejects.toThrow(/inputDigest is malformed/u);
    // The `input.inputDigest &&` guard: absent is legal and defaults downstream.
    await expect(emitter().emit(emissionInput({ inputDigest: undefined }))).resolves.toBeTruthy();
  });

  it("rejects a malformed retrieved-context digest", async () => {
    await expect(
      emitter().emit(emissionInput({ retrievedContextDigests: [`sha256:${"c".repeat(64)}`, "nope"] }))
    ).rejects.toThrow(/retrieved context digest is malformed/u);
  });

  it("accepts both sha256 and hmac-sha256 digest prefixes", async () => {
    // The pattern is an alternation. Without a positive case for each side, a
    // mutant deleting one branch would survive.
    await expect(
      emitter().emit(
        emissionInput({ retrievedContextDigests: [`sha256:${"c".repeat(64)}`, `hmac-sha256:${"d".repeat(64)}`] })
      )
    ).resolves.toBeTruthy();
  });

  it("rejects a non-finite latencyMs", async () => {
    await expect(emitter().emit(emissionInput({ latencyMs: Number.NaN }))).rejects.toThrow(/latencyMs must be finite/u);
    await expect(emitter().emit(emissionInput({ latencyMs: Number.POSITIVE_INFINITY }))).rejects.toThrow(/latencyMs must be finite/u);
  });

  it("rejects a negative or non-finite costEstimateUsd but allows it to be absent", async () => {
    await expect(emitter().emit(emissionInput({ costEstimateUsd: -1 }))).rejects.toThrow(/costEstimateUsd/u);
    await expect(emitter().emit(emissionInput({ costEstimateUsd: Number.NaN }))).rejects.toThrow(/costEstimateUsd/u);
    await expect(emitter().emit(emissionInput({ costEstimateUsd: 0 }))).resolves.toBeTruthy();
    await expect(emitter().emit(emissionInput({ costEstimateUsd: undefined }))).resolves.toBeTruthy();
  });

  it("records the higher of the pre- and post-decision risk scores", async () => {
    // `Math.max` over the two stages. A mutant taking only one side would
    // under-report risk whenever the other stage scored higher, which is the
    // direction that matters.
    const receipt = await emitter().emit(
      emissionInput({ preDecision: decision("pre_model", "ALLOW", 0), postDecision: decision("post_model", "REFUSE", 1) })
    );
    expect(receipt.risk_score).toBe(1);
  });
});

describe("emission: the signature returned by the signer is checked", () => {
  it("rejects an empty signature", async () => {
    await expect(emitter({ signer: hmacSigner({ signCanonical: async () => "" }) }).emit(emissionInput())).rejects.toThrow(
      /returned an empty signature/u
    );
  });

  it("rejects a non-string signature", async () => {
    await expect(
      emitter({ signer: hmacSigner({ signCanonical: (async () => 42) as never }) }).emit(emissionInput())
    ).rejects.toThrow(/returned an empty signature/u);
  });

  it("rejects a signature that decodes to zero bytes", async () => {
    // A base64 string that is non-empty but decodes to nothing. Only the decode
    // check catches this; the length check above passes it.
    await expect(
      emitter({ signer: hmacSigner({ signCanonical: async () => "=" }) }).emit(emissionInput())
    ).rejects.toThrow(/decodes to (zero|empty)/u);
  });
});

describe("emission: the immutable-key-ARN rule is enforced after signing too", () => {
  it("rejects a KMS signer that exposes a mutable alias keyId", async () => {
    // The post-hoc half of the rule. Construction-time checks cannot catch a
    // signer whose keyId is only observable once signing has happened, so this
    // guard re-reads it. Both alias spellings must be caught.
    for (const aliasKeyId of ["alias/active-key", "arn:aws:kms:us-east-1:111122223333:alias/active-key"]) {
      const signer = hmacSigner({ algorithm: "KMS_SIGN_RSASSA_PSS_SHA_256", keyId: aliasKeyId });
      await expect(emitter({ signer }).emit(emissionInput())).rejects.toThrow(/exposed mutable alias keyId after signing/u);
    }
  });

  it("accepts a KMS signer using an immutable key ARN", async () => {
    // The control: the guard must reject aliases, not KMS signing.
    const signer = hmacSigner({ algorithm: "KMS_SIGN_RSASSA_PSS_SHA_256", keyId: VALID_KEY_ID });
    await expect(emitter({ signer }).emit(emissionInput())).resolves.toBeTruthy();
  });

  it("does not apply the KMS alias rule to local HMAC signing", async () => {
    // `algorithm === KMS_...` is a conjunction. Without this, a mutant dropping
    // the algorithm test would survive, and every local-dev keyId that happened
    // to start with "alias/" would fail for the wrong reason.
    const signer = hmacSigner({ algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY", keyId: "alias/local" });
    await expect(emitter({ signer }).emit(emissionInput())).resolves.toBeTruthy();
  });
});

/** A repository stub whose behavior each test dictates. */
function repo(overrides: Partial<DecisionReceiptRepository> = {}): DecisionReceiptRepository {
  return {
    get: async () => null,
    put: async (receipt) => ({ status: "CREATED", receipt, persistedAt: PERSISTED_AT }),
    ...overrides
  } as DecisionReceiptRepository;
}

describe("emission: replay and chain-head conflicts", () => {
  it("returns the stored receipt when a replay matches exactly", async () => {
    const first = await emitter().emit(emissionInput());
    const stored = emitter({ repository: repo({ get: async () => first }) });
    await expect(stored.emit(emissionInput())).resolves.toEqual(first);
  });

  it("raises IntegrityCollisionError when a replay finds a different digest", async () => {
    // The case that matters: the same receipt id already exists but its canonical
    // content disagrees. Returning either receipt would silently pick a winner
    // between two conflicting records of the same event.
    const other = await emitter().emit(emissionInput({ modelId: "anthropic.claude-other" }));
    const colliding = emitter({ repository: repo({ get: async () => other }) });

    await expect(colliding.emit(emissionInput())).rejects.toThrow(IntegrityCollisionError);
    await expect(colliding.emit(emissionInput())).rejects.toThrow(/mismatched canonical digests/u);
  });

  it("retries once when the chain head advances, then succeeds", async () => {
    let puts = 0;
    let heads = 0;
    const repository = repo({
      latestHashForTenant: async () => {
        heads += 1;
        return null;
      },
      put: async (receipt) => {
        puts += 1;
        if (puts === 1) {
          throw new ChainHeadConflictError("head moved", { tenantId: "t", requestId: "r" });
        }
        return { status: "CREATED", receipt, persistedAt: PERSISTED_AT };
      }
    });

    await expect(emitter({ repository }).emit(emissionInput())).resolves.toBeTruthy();
    expect(puts, "the first put conflicts and the second succeeds").toBe(2);
    expect(heads, "the chain head is re-read on the retry").toBe(2);
  });

  it("gives up after the retry budget and propagates the conflict", async () => {
    // Kills the `attempt < 2` bound: without it this retries forever.
    //
    // NOTE — the terminal `throw new ChainHeadConflictError("Receipt chain head
    // kept advancing during receipt emission")` after the loop is UNREACHABLE.
    // Every path through the loop body returns, continues, or throws, and
    // `continue` is guarded by `attempt < 2`, so on the third attempt the catch
    // rethrows and the loop never completes normally. E10 reported that line as
    // NoCoverage and it cannot be covered. The observable behaviour is that the
    // LAST ChainHeadConflictError propagates, which carries the real conflict
    // context rather than a generic message — so this is dead code that reads
    // like a safety net, not a missing behaviour. Asserted as it is, not as the
    // unreachable line describes it.
    let puts = 0;
    const repository = repo({
      latestHashForTenant: async () => null,
      put: async () => {
        puts += 1;
        throw new ChainHeadConflictError("head moved", { tenantId: "t", requestId: "r" });
      }
    });

    await expect(emitter({ repository }).emit(emissionInput())).rejects.toThrow(ChainHeadConflictError);
    await expect(emitter({ repository }).emit(emissionInput())).rejects.toThrow(/head moved/u);
    expect(puts, "three attempts across two emits, then give up each time").toBe(6);
  });

  it("does not retry when the caller pinned previousReceiptHash", async () => {
    // Retrying is only meaningful when the emitter chose the predecessor itself.
    // If the caller pinned one, re-reading the head would silently emit against
    // a different parent than the caller asked for.
    let puts = 0;
    const repository = repo({
      latestHashForTenant: async () => null,
      put: async () => {
        puts += 1;
        throw new ChainHeadConflictError("head moved", { tenantId: "t", requestId: "r" });
      }
    });

    await expect(
      emitter({ repository }).emit(emissionInput({ previousReceiptHash: null }))
    ).rejects.toThrow(ChainHeadConflictError);
    expect(puts, "no retry when the parent was pinned by the caller").toBe(1);
  });

  it("propagates a non-conflict persistence error without retrying", async () => {
    let puts = 0;
    const repository = repo({
      latestHashForTenant: async () => null,
      put: async () => {
        puts += 1;
        throw new Error("dynamo exploded");
      }
    });

    await expect(emitter({ repository }).emit(emissionInput())).rejects.toThrow(/dynamo exploded/u);
    expect(puts).toBe(1);
  });

  it("accepts an idempotent-existing persistence result", async () => {
    const repository = repo({ put: async (receipt) => ({ status: "IDEMPOTENT_EXISTING", receipt, persistedAt: PERSISTED_AT }) });
    await expect(emitter({ repository }).emit(emissionInput())).resolves.toBeTruthy();
  });

  it("rejects an unrecognized persistence status rather than returning nothing", async () => {
    // Kills the switch `default`. A status the emitter does not understand must
    // not be treated as success — the receipt may not be durable.
    const repository = repo({
      put: async (receipt) => ({ status: "PARTIALLY_WRITTEN", receipt, persistedAt: PERSISTED_AT } as never)
    });
    await expect(emitter({ repository }).emit(emissionInput())).rejects.toThrow(
      /Unsupported decision receipt persistence status: PARTIALLY_WRITTEN/u
    );
  });

  it("emits without persistence when no repository is configured", async () => {
    const receipt = await emitter().emit(emissionInput());
    expect(receipt.receipt_id).toBeTruthy();
  });
});

describe("emission: round-two survivors from the re-measurement", () => {
  it("looks the replay candidate up by tenant and receipt id, not by nothing", async () => {
    // Kills the line-90 lookup argument. A stub that ignores its arguments cannot
    // tell "asked for the right receipt" from "asked for {}", and a replay check
    // that queries the wrong key silently never finds a collision.
    let lookup: { tenantId: string; receiptId: string } | undefined;
    const repository = repo({
      get: async (input) => {
        lookup = input;
        return null;
      }
    });
    const receipt = await emitter({ repository }).emit(emissionInput());
    expect(lookup?.tenantId).toBe(receipt.tenant_id_hash);
    expect(lookup?.receiptId).toBe(receipt.receipt_id);
  });

  it("carries both digests and the identity on an integrity collision", async () => {
    // Kills the line-100 context object. The message alone does not say WHICH
    // receipt collided or how the two differed, which is the whole point of
    // raising a typed error rather than a string.
    const other = await emitter().emit(emissionInput({ modelId: "anthropic.claude-other" }));
    const incoming = await emitter().emit(emissionInput());
    const colliding = emitter({ repository: repo({ get: async () => other }) });

    const error = await colliding.emit(emissionInput()).then(
      () => undefined,
      (caught: unknown) => caught as IntegrityCollisionError
    );

    expect(error).toBeInstanceOf(IntegrityCollisionError);
    expect(error?.context.tenantId).toBe(incoming.tenant_id_hash);
    // The INCOMING receipt id, not the stored one: the collision is reported
    // against the receipt being emitted, which is the one the caller can act on.
    expect(error?.context.receiptId).toBe(incoming.receipt_id);
    expect(error?.context.incomingDigest).not.toBe(error?.context.storedDigest);
  });

  it("defaults a missing inputDigest to the digest of the empty string", async () => {
    // Kills the line-154 default. A mutant substituting any other constant would
    // change receipt identity for every receipt emitted without an input digest,
    // and no test pinned the value.
    const receipt = await emitter().emit(emissionInput({ inputDigest: undefined }));
    expect(receipt.input_digest).toBe(publicSha256Digest(""));
  });

  it("rejects a non-string where a non-empty string is required", async () => {
    // Kills the line-260 `typeof value !== "string"` half of assertNonEmpty. The
    // empty-string case alone leaves it alive, and these inputs cross a trust
    // boundary where the declared type is not a guarantee.
    for (const bad of [null, undefined, 42, {}]) {
      await expect(
        emitter().emit(emissionInput({ modelId: bad as unknown as string })),
        `modelId: ${String(bad)}`
      ).rejects.toThrow(/modelId must be a non-empty string/u);
    }
  });

  it("recognizes alias ARNs across partitions but not key ARNs", async () => {
    // Kills the line-22 KMS_ALIAS_ARN_PATTERN mutants. One alias spelling leaves
    // the anchors and partition group untested; a pattern that matched key ARNs
    // too would reject every legitimate KMS signer.
    const aliases = [
      "alias/active-key",
      "arn:aws:kms:us-east-1:111122223333:alias/active-key",
      "arn:aws-us-gov:kms:us-gov-west-1:111122223333:alias/active-key",
      "arn:aws-cn:kms:cn-north-1:111122223333:alias/active-key"
    ];
    for (const keyId of aliases) {
      const signer = hmacSigner({ algorithm: "KMS_SIGN_RSASSA_PSS_SHA_256", keyId });
      await expect(emitter({ signer }).emit(emissionInput()), keyId).rejects.toThrow(/exposed mutable alias keyId/u);
    }

    const notAliases = [VALID_KEY_ID, "00000000-0000-0000-0000-00000000000a"];
    for (const keyId of notAliases) {
      const signer = hmacSigner({ algorithm: "KMS_SIGN_RSASSA_PSS_SHA_256", keyId });
      await expect(emitter({ signer }).emit(emissionInput()), keyId).resolves.toBeTruthy();
    }
  });

  it("anchors the digest pattern at both ends and requires 64 lowercase hex", async () => {
    // Kills the line-23 SHA256_OR_HMAC_DIGEST_PATTERN anchor mutants. Each input
    // below is rejected only by a specific part of the pattern.
    const malformed = [
      `sha256:${"c".repeat(63)}`,           // too short
      `sha256:${"c".repeat(65)}`,           // too long
      `sha256:${"C".repeat(64)}`,           // uppercase hex
      `SHA256:${"c".repeat(64)}`,           // uppercase prefix
      "c".repeat(64),                        // no prefix
      ` sha256:${"c".repeat(64)}`,          // leading space defeats ^
      `sha256:${"c".repeat(64)} `           // trailing space defeats $
    ];
    for (const digest of malformed) {
      await expect(
        emitter().emit(emissionInput({ retrievedContextDigests: [digest] })),
        JSON.stringify(digest)
      ).rejects.toThrow(/retrieved context digest is malformed/u);
    }
  });
});
