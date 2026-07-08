import { SignCommand, type KMSClient } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import { buildReceiptPayload } from "../../../packages/receipt-schema/src/receipt";
import { digestPayloadForSigning, signReceiptPayload } from "../../../services/signing/kms/signer";

const KEY_ARN = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-000000000001";

describe("KMS signer helpers", () => {
  it("digests validated canonical receipt payloads", () => {
    const payload = buildReceiptPayload({
      tenantSlug: "acme-lab",
      issuedAt: "2026-07-06T12:00:00.000Z",
      subject: { kind: "dataset-version", id: "curated-oil" },
      evidenceObjects: ["ev_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      governanceContext: {
        lakeFormationTags: { tenant_slug: "acme-lab", classification: "internal" },
        columnRestrictions: [],
        policyCompilerVersion: "50.0.0"
      }
    });
    const digest = digestPayloadForSigning(payload);
    expect(digest.digest).toHaveLength(32);
    expect(digest.digestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest.canonicalPayload).toContain('"receiptId"');
  });

  it("rejects mutable alias key ids before signing evidence receipts", async () => {
    const payload = receiptPayload();

    await expect(signReceiptPayload(payload, { keyId: "alias/test" })).rejects.toThrow(/immutable KMS key/u);
  });

  it("records the immutable KMS key identity attested by Sign", async () => {
    const commands: string[] = [];
    const client = {
      async send(command: SignCommand) {
        commands.push(command.constructor.name);
        return {
          KeyId: KEY_ARN,
          Signature: Buffer.from("signature")
        };
      }
    } as unknown as KMSClient;

    const signature = await signReceiptPayload(receiptPayload(), { keyId: KEY_ARN, client });

    expect(commands).toEqual(["SignCommand"]);
    expect(signature.keyId).toBe(KEY_ARN);
    expect(signature.signatureBase64).toBe(Buffer.from("signature").toString("base64"));
  });
});

function receiptPayload() {
  return buildReceiptPayload({
    tenantSlug: "acme-lab",
    issuedAt: "2026-07-06T12:00:00.000Z",
    subject: { kind: "dataset-version", id: "curated-oil" },
    evidenceObjects: ["ev_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
    governanceContext: {
      lakeFormationTags: { tenant_slug: "acme-lab", classification: "internal" },
      columnRestrictions: [],
      policyCompilerVersion: "50.0.0"
    }
  });
}
