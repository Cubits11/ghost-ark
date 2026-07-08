import { spawnSync } from "child_process";
import { constants, generateKeyPairSync, KeyObject, sign as signDigest } from "crypto";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildReceiptPayload, ReceiptRecord, receiptDigest } from "../../../packages/receipt-schema/src/receipt";
import { verifyReceiptRecord } from "../../../tools/scripts/receiptVerify";
import { verifyReceiptSignatureWithPublicKey } from "../../../services/signing/kms/verifier";

const now = "2026-07-07T00:00:00.000Z";

function buildRecord(): ReceiptRecord {
  const payload = buildReceiptPayload({
    tenantSlug: "acme-lab",
    issuedAt: now,
    subject: {
      kind: "dataset-version",
      id: "smoke-dataset-v1",
      uri: "s3://bucket/tenants/acme-lab/smoke.json"
    },
    evidenceObjects: ["s3://bucket/tenants/acme-lab/evidence.json"],
    lineageEventIds: [],
    claimIds: [],
    governanceContext: {
      lakeFormationTags: {
        tenant_slug: "acme-lab",
        classification: "internal",
        evidence_role: "smoke-test"
      },
      columnRestrictions: [],
      policyCompilerVersion: "50.0.0"
    },
    transform: {
      runId: "verify-test-run",
      jobName: "receipt-verify-test",
      parameters: {}
    }
  });

  return {
    payload,
    signature: {
      keyId: "alias/test",
      algorithm: "RSASSA_PSS_SHA_256",
      messageType: "DIGEST",
      digestSha256: receiptDigest(payload),
      signatureBase64: "ZmFrZS1zaWduYXR1cmU=",
      signedAt: now
    },
    status: "issued",
    createdAt: now,
    updatedAt: now
  };
}

function keyPair(): { privateKey: KeyObject; publicKeyPem: string } {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey,
    publicKeyPem: pair.publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function signRecord(record: ReceiptRecord, privateKey: KeyObject): ReceiptRecord {
  const digestSha256 = receiptDigest(record.payload);
  const signature = signDigest(
    null,
    Buffer.from(digestSha256, "hex"),
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST
    }
  );

  return {
    ...record,
    signature: {
      ...record.signature,
      keyId: "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000001",
      digestSha256,
      signatureBase64: signature.toString("base64")
    }
  };
}

function writeFixture(record: ReceiptRecord, publicKeyPem: string): { receiptPath: string; publicKeyPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ghost-ark-verify-"));
  const receiptPath = path.join(dir, "receipt.json");
  const publicKeyPath = path.join(dir, "public-key.pem");
  writeFileSync(receiptPath, JSON.stringify(record, null, 2));
  writeFileSync(publicKeyPath, publicKeyPem);
  return { receiptPath, publicKeyPath };
}

describe("receipt verification", () => {
  it("passes for a valid receipt record when signature verifier accepts it", async () => {
    const record = buildRecord();
    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(true);
    expect(result.checks.map((check) => [check.name, check.passed])).toEqual([
      ["schema", true],
      ["tenant", true],
      ["receiptId", true],
      ["digest", true],
      ["messageType", true],
      ["algorithm", true],
      ["signature", true]
    ]);
  });

  it("verifies a receipt locally with a PEM public key", async () => {
    const keys = keyPair();
    const record = signRecord(buildRecord(), keys.privateKey);

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async (payload, signature) => verifyReceiptSignatureWithPublicKey(payload, signature, keys.publicKeyPem)
    });

    expect(result.verdict).toBe(true);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(true);
  });

  it("fails when the expected tenant does not match the receipt tenant", async () => {
    const record = buildRecord();
    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "beta-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "tenant")?.passed).toBe(false);
  });

  it("fails before signature verification when the stored digest is tampered", async () => {
    const record = buildRecord();
    let signatureVerifierCalled = false;
    record.signature.digestSha256 = "0".repeat(64);

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => {
        signatureVerifierCalled = true;
        return true;
      }
    });

    expect(result.verdict).toBe(false);
    expect(signatureVerifierCalled).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails before signature verification when the payload is tampered after signing", async () => {
    const record = buildRecord();
    let signatureVerifierCalled = false;

    record.payload.subject.id = "tampered-dataset-version";

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => {
        signatureVerifierCalled = true;
        return true;
      }
    });

    expect(result.verdict).toBe(false);
    expect(signatureVerifierCalled).toBe(false);
    expect(result.checks.find((check) => check.name === "receiptId")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails when the signature verifier rejects the signature", async () => {
    const record = buildRecord();

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => false
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "schema")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "receiptId")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "digest")?.passed).toBe(true);
    expect(result.checks.find((check) => check.name === "signature")?.passed).toBe(false);
  });

  it("fails schema validation for malformed receipt records", async () => {
    const record = buildRecord();
    const malformed = {
      ...record,
      payload: {
        ...record.payload,
        receiptId: "not-a-valid-receipt-id"
      }
    };

    const result = await verifyReceiptRecord(malformed, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe("schema");
    expect(result.checks[0].passed).toBe(false);
  });

  it("fails when signing metadata uses an unexpected algorithm", async () => {
    const record = buildRecord();

    record.signature.algorithm = "RSASSA_PKCS1_V1_5_SHA_256";

    const result = await verifyReceiptRecord(record, {
      expectedTenantSlug: "acme-lab",
      verifySignature: async () => true
    });

    expect(result.verdict).toBe(false);
    expect(result.checks.find((check) => check.name === "algorithm")?.passed).toBe(false);
  });

  it("runs the standalone offline verifier without AWS calls", () => {
    const keys = keyPair();
    const record = signRecord(buildRecord(), keys.privateKey);
    const { receiptPath, publicKeyPath } = writeFixture(record, keys.publicKeyPem);

    const result = spawnSync(process.execPath, ["tools/ghost-verify.mjs", "--receipt", receiptPath, "--key", publicKeyPath, "--tenant", "acme-lab"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("VERDICT: PASS");
    expect(result.stdout).toContain("PASS signature");
  });

  it("makes the standalone offline verifier fail on a tampered payload", () => {
    const keys = keyPair();
    const record = signRecord(buildRecord(), keys.privateKey);
    record.payload.subject.id = "tampered-dataset-version";
    const { receiptPath, publicKeyPath } = writeFixture(record, keys.publicKeyPem);

    const result = spawnSync(process.execPath, ["tools/ghost-verify.mjs", "--receipt", receiptPath, "--key", publicKeyPath, "--tenant", "acme-lab"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("VERDICT: FAIL");
    expect(result.stdout).toContain("FAIL receipt_id");
  });
});
