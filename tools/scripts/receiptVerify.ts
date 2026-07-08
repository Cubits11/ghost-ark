import fs from "fs";
import { ReceiptPayload, ReceiptRecord, ReceiptSignature, receiptDigest, validateReceiptRecord } from "../../packages/receipt-schema/src/receipt";
import { receiptIdFromPayload } from "../../packages/receipt-schema/src/hashCanonicalization";
import { ReceiptRepository } from "../../services/ledger/dynamodb/data/receiptRepository";
import { verifyReceiptSignature, verifyReceiptSignatureWithPublicKey } from "../../services/signing/kms/verifier";
import {
  KeyManifest,
  findManifestEntryForKey,
  readKeyManifestFile,
  verifyKeyManifestEpoch
} from "../../packages/enforcement-runtime/src/receipts/keyManifest";
import { isImmutableKmsKeyId } from "../../packages/enforcement-runtime/src/aws/kmsKeyIdentity";

export interface ReceiptVerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ReceiptVerificationResult {
  verdict: boolean;
  receiptId?: string;
  tenantSlug?: string;
  checks: ReceiptVerificationCheck[];
  nonClaim: string;
}

export interface VerifyReceiptRecordOptions {
  expectedTenantSlug?: string;
  verifySignature?: (payload: ReceiptPayload, signature: ReceiptSignature) => Promise<boolean>;
  keyManifest?: KeyManifest;
}

function pass(name: string, detail: string): ReceiptVerificationCheck {
  return { name, passed: true, detail };
}

function fail(name: string, detail: string): ReceiptVerificationCheck {
  return { name, passed: false, detail };
}

function payloadWithoutReceiptId(payload: ReceiptPayload): Omit<ReceiptPayload, "receiptId"> {
  const { receiptId: _receiptId, ...withoutId } = payload;
  return withoutId;
}

export async function verifyReceiptRecord(
  value: unknown,
  options: VerifyReceiptRecordOptions = {}
): Promise<ReceiptVerificationResult> {
  const checks: ReceiptVerificationCheck[] = [];
  let record: ReceiptRecord;

  try {
    record = validateReceiptRecord(value);
    checks.push(pass("schema", "Receipt record matches ghost-ark receipt schema."));
  } catch (error) {
    checks.push(fail("schema", error instanceof Error ? error.message : String(error)));
    return {
      verdict: false,
      checks,
      nonClaim: nonClaim()
    };
  }

  const payload = record.payload;
  const signature = record.signature;

  if (options.expectedTenantSlug) {
    if (payload.tenantSlug === options.expectedTenantSlug) {
      checks.push(pass("tenant", `Receipt tenantSlug matches expected tenant ${options.expectedTenantSlug}.`));
    } else {
      checks.push(
        fail(
          "tenant",
          `Receipt tenantSlug ${payload.tenantSlug} does not match expected tenant ${options.expectedTenantSlug}.`
        )
      );
    }
  } else {
    checks.push(pass("tenant", `No expected tenant supplied; observed tenantSlug ${payload.tenantSlug}.`));
  }

  const recomputedReceiptId = receiptIdFromPayload(payloadWithoutReceiptId(payload));
  if (recomputedReceiptId === payload.receiptId) {
    checks.push(pass("receiptId", "ReceiptId matches canonical payload hash."));
  } else {
    checks.push(
      fail(
        "receiptId",
        `ReceiptId mismatch. Expected ${recomputedReceiptId}; observed ${payload.receiptId}.`
      )
    );
  }

  const recomputedDigest = receiptDigest(payload);
  if (recomputedDigest === signature.digestSha256) {
    checks.push(pass("digest", "Signature digestSha256 matches recomputed canonical payload digest."));
  } else {
    checks.push(
      fail(
        "digest",
        `Digest mismatch. Expected ${recomputedDigest}; observed ${signature.digestSha256}.`
      )
    );
  }

  if (signature.messageType === "DIGEST") {
    checks.push(pass("messageType", "Signature messageType is DIGEST."));
  } else {
    checks.push(fail("messageType", `Unsupported signature messageType ${signature.messageType}.`));
  }

  if (signature.algorithm === "RSASSA_PSS_SHA_256") {
    checks.push(pass("algorithm", "Signature algorithm is RSASSA_PSS_SHA_256."));
  } else {
    checks.push(fail("algorithm", `Unexpected signature algorithm ${signature.algorithm}.`));
  }

  if (isImmutableKmsKeyId(signature.keyId)) {
    checks.push(pass("keyId", "Signature keyId is an immutable KMS key ARN or key UUID."));
  } else {
    checks.push(fail("keyId", "Signature keyId must be an immutable KMS key ARN or key UUID; aliases are not accepted."));
  }

  if (options.keyManifest) {
    const manifestCheck = verifyKeyManifestEpoch({
      manifest: options.keyManifest,
      keyId: signature.keyId,
      algorithm: signature.algorithm,
      timestamp: payload.issuedAt
    });
    checks.push({
      name: manifestCheck.name,
      passed: manifestCheck.passed,
      detail: manifestCheck.detail
    });
  }

  const digestPassed = checks.find((check) => check.name === "digest")?.passed === true;
  const schemaPassed = checks.find((check) => check.name === "schema")?.passed === true;
  const keyIdPassed = checks.find((check) => check.name === "keyId")?.passed === true;

  if (schemaPassed && digestPassed && keyIdPassed) {
    try {
      const verifier = options.verifySignature ?? verifyReceiptSignature;
      const signatureValid = await verifier(payload, signature);
      checks.push(
        signatureValid
          ? pass("signature", "KMS signature verification returned valid.")
          : fail("signature", "KMS signature verification returned invalid.")
      );
    } catch (error) {
      checks.push(fail("signature", error instanceof Error ? error.message : String(error)));
    }
  } else {
    checks.push(fail("signature", "Signature verification skipped because schema, digest, or key identity check failed."));
  }

  const verdict = checks.every((check) => check.passed);

  return {
    verdict,
    receiptId: payload.receiptId,
    tenantSlug: payload.tenantSlug,
    checks,
    nonClaim: nonClaim()
  };
}

function nonClaim(): string {
  return "This verifies receipt schema, canonical digest, tenant expectation, and signature validity only. It does not prove evidence truth, system safety, compliance, production readiness, or deployment safety.";
}

interface CliArgs {
  tenant?: string;
  receipt?: string;
  table?: string;
  file?: string;
  publicKey?: string;
  keyManifest?: string;
  stage: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { stage: process.env.STAGE ?? "dev" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--tenant") {
      args.tenant = next;
      index += 1;
    } else if (arg === "--receipt") {
      args.receipt = next;
      index += 1;
    } else if (arg === "--table") {
      args.table = next;
      index += 1;
    } else if (arg === "--file") {
      args.file = next;
      index += 1;
    } else if (arg === "--public-key") {
      args.publicKey = next;
      index += 1;
    } else if (arg === "--key-manifest") {
      args.keyManifest = next;
      index += 1;
    } else if (arg === "--stage") {
      args.stage = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`Ghost Ark receipt verifier

Usage:

  npm run receipt:verify -- --tenant <tenantSlug> --receipt <receiptId>

  npm run receipt:verify -- --tenant <tenantSlug> --receipt <receiptId> --table <tableName>

  npm run receipt:verify -- --tenant <tenantSlug> --file <receiptRecord.json>

  npm run receipt:verify -- --tenant <tenantSlug> --file <receiptRecord.json> --public-key <publicKey.pem>

Options:

  --tenant   Expected tenant slug.
  --receipt  Receipt id to fetch from DynamoDB.
  --table    DynamoDB receipt table. Defaults to RECEIPT_LEDGER_TABLE or ghost-ark-<stage>-receipts.
  --file     Local JSON receipt record file.
  --public-key
             PEM public key for fully local signature verification. When omitted, verification uses AWS KMS Verify.
  --key-manifest
             Versioned key manifest JSON requiring the receipt timestamp to fall in the signing key epoch.
  --stage    Stage used for default table name. Defaults to STAGE or dev.

Non-claim:

  Verification does not prove evidence truth, AI safety, compliance, production readiness, or deployment safety.
`);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function loadRecord(args: CliArgs): Promise<unknown> {
  if (args.file) {
    return readJsonFile(args.file);
  }

  if (!args.tenant || !args.receipt) {
    throw new Error("Either --file or both --tenant and --receipt are required.");
  }

  const tableName = args.table ?? process.env.RECEIPT_LEDGER_TABLE ?? `ghost-ark-${args.stage}-receipts`;
  const repository = new ReceiptRepository({ tableName });
  return repository.get(args.tenant, args.receipt);
}

function printResult(result: ReceiptVerificationResult): void {
  console.log("");
  console.log("GHOST ARK RECEIPT VERIFICATION");
  console.log("================================");
  console.log("");

  if (result.receiptId) {
    console.log(`receiptId: ${result.receiptId}`);
  }
  if (result.tenantSlug) {
    console.log(`tenantSlug: ${result.tenantSlug}`);
  }

  console.log("");

  for (const check of result.checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  console.log("");
  console.log(`VERDICT: ${result.verdict ? "PASS" : "FAIL"}`);
  console.log("");
  console.log(`Non-claim: ${result.nonClaim}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const record = await loadRecord(args);
  const manifest = args.keyManifest ? readKeyManifestFile(args.keyManifest) : undefined;
  const parsedRecord = validateReceiptRecord(record);
  const manifestPublicKey =
    manifest !== undefined
      ? findManifestEntryForKey(manifest, parsedRecord.signature.keyId, parsedRecord.signature.algorithm)?.publicKeyPem
      : undefined;
  const publicKeyPem = args.publicKey ? fs.readFileSync(args.publicKey, "utf8") : manifestPublicKey;
  const result = await verifyReceiptRecord(record, {
    expectedTenantSlug: args.tenant,
    keyManifest: manifest,
    verifySignature: publicKeyPem
      ? async (payload, signature) => verifyReceiptSignatureWithPublicKey(payload, signature, publicKeyPem)
      : undefined
  });
  printResult(result);

  if (!result.verdict) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
