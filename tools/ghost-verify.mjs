#!/usr/bin/env node
import { constants, createHash, createPublicKey, verify as verifySignature } from "crypto";
import fs from "fs";

const nonClaim =
  "This verifies receipt schema shape, canonical digests, tenant expectation, and RSA-PSS signature validity only. It does not prove evidence truth, AI safety, compliance, production readiness, or deployment safety.";

function usage() {
  console.log(`Ghost Ark offline receipt verifier

Usage:
  node tools/ghost-verify.mjs --receipt <receiptRecord.json> --key <publicKey.pem> [--tenant <tenantSlug>]

Options:
  --receipt  Local Ghost Ark receipt record JSON file.
  --key      PEM public key exported from the signing key.
  --tenant   Optional expected tenant slug.
  --help     Show this help text.
`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--receipt") {
      args.receipt = next;
      index += 1;
    } else if (arg === "--key" || arg === "--public-key") {
      args.key = next;
      index += 1;
    } else if (arg === "--tenant") {
      args.tenant = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.receipt || !args.key) {
    throw new Error("--receipt and --key are required");
  }

  return args;
}

function canonicalize(value) {
  if (value === undefined) {
    throw new Error("Canonical JSON cannot encode undefined values");
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot encode non-finite numbers");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Unsupported canonical JSON object type: ${value.constructor?.name ?? "unknown"}`);
    }
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON value type: ${typeof value}`);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function payloadWithoutReceiptId(payload) {
  const { receiptId, ...withoutReceiptId } = payload;
  return withoutReceiptId;
}

function check(checks, name, passed, detail) {
  checks.push({ name, passed, detail });
}

function verifyRecord(record, publicKeyPem, expectedTenant) {
  const checks = [];

  if (!isRecord(record) || !isRecord(record.payload) || !isRecord(record.signature)) {
    check(checks, "schema", false, "Receipt record must contain payload and signature objects.");
    return { verdict: false, checks };
  }
  check(checks, "schema", true, "Receipt record contains payload and signature objects.");

  const { payload, signature } = record;
  if (expectedTenant) {
    check(
      checks,
      "tenant",
      payload.tenantSlug === expectedTenant,
      payload.tenantSlug === expectedTenant
        ? `Receipt tenantSlug matches expected tenant ${expectedTenant}.`
        : `Receipt tenantSlug ${payload.tenantSlug} does not match expected tenant ${expectedTenant}.`
    );
  } else {
    check(checks, "tenant", true, `No expected tenant supplied; observed tenantSlug ${payload.tenantSlug}.`);
  }

  let canonicalReceiptIdentity;
  let canonicalPayload;
  try {
    canonicalReceiptIdentity = canonicalize(payloadWithoutReceiptId(payload));
    canonicalPayload = canonicalize(payload);
    check(checks, "canonical_json", true, "Canonical JSON serialization completed.");
  } catch (error) {
    check(checks, "canonical_json", false, error instanceof Error ? error.message : String(error));
    return { verdict: false, checks };
  }

  const expectedReceiptId = `rct_${sha256Hex(canonicalReceiptIdentity)}`;
  check(
    checks,
    "receipt_id",
    payload.receiptId === expectedReceiptId,
    payload.receiptId === expectedReceiptId
      ? "ReceiptId matches canonical identity payload hash."
      : `ReceiptId mismatch. Expected ${expectedReceiptId}; observed ${payload.receiptId}.`
  );

  const digest = sha256Bytes(canonicalPayload);
  const digestSha256 = digest.toString("hex");
  check(
    checks,
    "digest",
    signature.digestSha256 === digestSha256,
    signature.digestSha256 === digestSha256
      ? "Signature digestSha256 matches recomputed canonical payload digest."
      : `Digest mismatch. Expected ${digestSha256}; observed ${signature.digestSha256}.`
  );

  check(
    checks,
    "algorithm",
    signature.messageType === "DIGEST" && signature.algorithm === "RSASSA_PSS_SHA_256",
    signature.messageType === "DIGEST" && signature.algorithm === "RSASSA_PSS_SHA_256"
      ? "Signature metadata uses DIGEST and RSASSA_PSS_SHA_256."
      : `Unsupported signature metadata: ${signature.messageType ?? "missing"} / ${signature.algorithm ?? "missing"}.`
  );

  const prerequisitesPassed = checks.every((entry) => entry.passed);
  if (!prerequisitesPassed) {
    check(checks, "signature", false, "Signature verification skipped because earlier checks failed.");
    return { verdict: false, checks };
  }

  try {
    const publicKey = createPublicKey(publicKeyPem);
    const signatureValid = verifySignature(
      null,
      digest,
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      },
      Buffer.from(signature.signatureBase64, "base64")
    );
    check(
      checks,
      "signature",
      signatureValid,
      signatureValid ? "RSA-PSS signature verifies with the supplied public key." : "RSA-PSS signature mismatch."
    );
  } catch (error) {
    check(checks, "signature", false, error instanceof Error ? error.message : String(error));
  }

  return {
    receiptId: payload.receiptId,
    tenantSlug: payload.tenantSlug,
    verdict: checks.every((entry) => entry.passed),
    checks
  };
}

function printResult(result) {
  console.log("");
  console.log("GHOST ARK OFFLINE RECEIPT VERIFICATION");
  console.log("======================================");
  console.log("");
  if (result.receiptId) {
    console.log(`receiptId: ${result.receiptId}`);
  }
  if (result.tenantSlug) {
    console.log(`tenantSlug: ${result.tenantSlug}`);
  }
  console.log("");
  for (const entry of result.checks) {
    console.log(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}`);
  }
  console.log("");
  console.log(`VERDICT: ${result.verdict ? "PASS" : "FAIL"}`);
  console.log("");
  console.log(`Non-claim: ${nonClaim}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const record = readJsonFile(args.receipt);
  const publicKeyPem = fs.readFileSync(args.key, "utf8");
  const result = verifyRecord(record, publicKeyPem, args.tenant);
  printResult(result);
  if (!result.verdict) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
