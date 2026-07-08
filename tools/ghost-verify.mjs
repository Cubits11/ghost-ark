#!/usr/bin/env node
import { constants, createHash, createPublicKey, verify as verifySignature } from "crypto";
import fs from "fs";

const nonClaim =
  "This verifies receipt schema shape, canonical digests, tenant expectation, and RSA-PSS signature validity only. It does not prove evidence truth, AI safety, compliance, production readiness, or deployment safety.";

function usage() {
  console.log(`Ghost Ark offline receipt verifier

Usage:
  node tools/ghost-verify.mjs --receipt <receiptRecord.json> [--key <publicKey.pem>] [--tenant <tenantSlug>]
  node tools/ghost-verify.mjs --verify-chain <decisionReceipts.json>

Options:
  --receipt  Local Ghost Ark receipt record JSON file.
  --key      PEM public key exported from the signing key.
  --tenant   Optional expected tenant slug.
  --key-manifest
            Versioned key-manifest JSON. May supply publicKeyPem and always enforces key validity epochs.
  --verify-chain
            JSON array of ghost.receipt.v1 decision receipts ordered by append time.
  --inclusion-proof
            Merkle inclusion proof JSON for a decision receipt chain head.
  --checkpoint
            Optional signed checkpoint JSON; when present, its merkleRoot is used as the proof root.
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
    } else if (arg === "--key-manifest") {
      args.keyManifest = next;
      index += 1;
    } else if (arg === "--verify-chain") {
      args.verifyChain = next;
      index += 1;
    } else if (arg === "--inclusion-proof") {
      args.inclusionProof = next;
      index += 1;
    } else if (arg === "--checkpoint") {
      args.checkpoint = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.receipt && !args.verifyChain) {
    throw new Error("Either --receipt or --verify-chain is required");
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

function publicKeyFromManifest(manifest, keyId, algorithm) {
  const entry = manifest?.keys?.find((item) => item.keyId === keyId && item.algorithm === algorithm) ??
    manifest?.keys?.find((item) => item.keyId === keyId);
  return entry?.publicKeyPem;
}

function verifyKeyManifestEpoch(manifest, keyId, algorithm, timestamp) {
  if (!manifest) {
    return { name: "key_manifest", passed: true, detail: "No key manifest supplied." };
  }
  const entry = manifest.keys?.find((item) => item.keyId === keyId && item.algorithm === algorithm) ??
    manifest.keys?.find((item) => item.keyId === keyId);
  if (!entry) {
    return { name: "key_manifest", passed: false, detail: `No manifest entry exists for keyId ${keyId}.` };
  }
  if (entry.algorithm !== algorithm) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Manifest algorithm mismatch. Expected ${entry.algorithm}; observed ${algorithm}.`
    };
  }
  const observed = Date.parse(timestamp);
  const validFrom = Date.parse(entry.validFrom);
  const validUntil = entry.validUntil ? Date.parse(entry.validUntil) : Number.POSITIVE_INFINITY;
  const revokedAt = entry.revokedAt ? Date.parse(entry.revokedAt) : undefined;
  if (!Number.isFinite(observed)) {
    return { name: "key_manifest", passed: false, detail: `Receipt timestamp is not parseable: ${timestamp}.` };
  }
  if (observed < validFrom) {
    return { name: "key_manifest", passed: false, detail: `Receipt timestamp ${timestamp} is before key validFrom ${entry.validFrom}.` };
  }
  if (observed >= validUntil) {
    return { name: "key_manifest", passed: false, detail: `Receipt timestamp ${timestamp} is not before key validUntil ${entry.validUntil}.` };
  }
  if (entry.status === "REVOKED" && revokedAt === undefined) {
    return { name: "key_manifest", passed: false, detail: `Manifest key ${entry.keyId} is revoked without a revokedAt timestamp.` };
  }
  if (revokedAt !== undefined && observed >= revokedAt) {
    return { name: "key_manifest", passed: false, detail: `Receipt timestamp ${timestamp} is at or after key revokedAt ${entry.revokedAt}.` };
  }
  return {
    name: "key_manifest",
    passed: true,
    detail:
      entry.status === "REVOKED"
        ? `Key ${entry.keyId} was revoked after this historical receipt timestamp.`
        : `Key ${entry.keyId} is ${entry.status} for the receipt timestamp.`
  };
}

function payloadWithoutReceiptId(payload) {
  const { receiptId, ...withoutReceiptId } = payload;
  return withoutReceiptId;
}

function check(checks, name, passed, detail) {
  checks.push({ name, passed, detail });
}

function verifyRecord(record, publicKeyPem, expectedTenant, manifest) {
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

  check(
    checks,
    "key_manifest",
    verifyKeyManifestEpoch(manifest, signature.keyId, signature.algorithm, payload.issuedAt).passed,
    verifyKeyManifestEpoch(manifest, signature.keyId, signature.algorithm, payload.issuedAt).detail
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

function parseDecisionEnvelope(receipt) {
  try {
    return JSON.parse(Buffer.from(receipt.receipt_signature ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function unsignedDecisionReceipt(receipt) {
  const { receipt_signature, ...unsigned } = receipt;
  return unsigned;
}

function decisionReceiptDigest(receipt) {
  return sha256Hex(canonicalize(unsignedDecisionReceipt(receipt)));
}

function signedDecisionReceiptHash(receipt) {
  return `sha256:${sha256Hex(canonicalize(receipt))}`;
}

function verifyDecisionReceiptRecord(receipt, publicKeyPem, manifest) {
  const checks = [];
  if (!isRecord(receipt) || receipt.schema_version !== "ghost.receipt.v1") {
    check(checks, "schema", false, "Decision receipt must contain schema_version ghost.receipt.v1.");
    return { verdict: false, checks };
  }
  check(checks, "schema", true, "Decision receipt uses ghost.receipt.v1.");

  let canonicalPayload;
  try {
    canonicalPayload = canonicalize(unsignedDecisionReceipt(receipt));
    check(checks, "canonical_json", true, "Canonical unsigned decision receipt serialization completed.");
  } catch (error) {
    check(checks, "canonical_json", false, error instanceof Error ? error.message : String(error));
    return { verdict: false, checks };
  }

  const { receipt_id, ...withoutId } = unsignedDecisionReceipt(receipt);
  const expectedReceiptId = `grct_${sha256Hex(canonicalize(withoutId))}`;
  check(
    checks,
    "receipt_id",
    receipt.receipt_id === expectedReceiptId,
    receipt.receipt_id === expectedReceiptId
      ? "Receipt id matches canonical unsigned envelope."
      : `Receipt id mismatch. Expected ${expectedReceiptId}; observed ${receipt.receipt_id}.`
  );

  const envelope = parseDecisionEnvelope(receipt);
  const embeddedDigest = typeof envelope.digestSha256 === "string" ? envelope.digestSha256 : "";
  const embeddedKeyId = typeof envelope.keyId === "string" ? envelope.keyId : "";
  const embeddedSignature = typeof envelope.signature === "string" ? envelope.signature : "";
  const recomputedDigest = decisionReceiptDigest(receipt);
  check(
    checks,
    "digest",
    embeddedDigest === recomputedDigest,
    embeddedDigest === recomputedDigest
      ? "Embedded signature digest matches canonical unsigned envelope digest."
      : `Digest mismatch. Expected ${recomputedDigest}; observed ${embeddedDigest}.`
  );
  check(
    checks,
    "key_id",
    embeddedKeyId.length > 0,
    embeddedKeyId.length > 0 ? `Signature keyId ${embeddedKeyId} is present.` : "Signature envelope does not contain a keyId."
  );
  const manifestCheck = verifyKeyManifestEpoch(manifest, embeddedKeyId, receipt.signature_alg, receipt.timestamp);
  check(checks, manifestCheck.name, manifestCheck.passed, manifestCheck.detail);

  if (!publicKeyPem) {
    check(checks, "signature", false, "No public key was supplied by --key or key manifest publicKeyPem.");
  } else if (receipt.signature_alg !== "KMS_SIGN_RSASSA_PSS_SHA_256") {
    check(checks, "signature", false, `Unsupported offline decision receipt algorithm ${receipt.signature_alg}.`);
  } else if (!embeddedSignature) {
    check(checks, "signature", false, "Signature envelope does not contain a signature.");
  } else if (!checks.every((entry) => entry.passed)) {
    check(checks, "signature", false, "Signature verification skipped because earlier checks failed.");
  } else {
    try {
      const signatureValid = verifySignature(
        null,
        sha256Bytes(canonicalPayload),
        {
          key: createPublicKey(publicKeyPem),
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST
        },
        Buffer.from(embeddedSignature, "base64")
      );
      check(
        checks,
        "signature",
        signatureValid,
        signatureValid ? "RSA-PSS decision receipt signature verifies with the supplied public key." : "RSA-PSS signature mismatch."
      );
    } catch (error) {
      check(checks, "signature", false, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    receiptId: receipt.receipt_id,
    tenantSlug: receipt.tenant_id_hash,
    verdict: checks.every((entry) => entry.passed),
    checks
  };
}

function verifyDecisionReceiptChain(receipts) {
  const checks = [];
  if (!Array.isArray(receipts)) {
    check(checks, "chain_schema", false, "Chain file must contain an array of decision receipts.");
    return { verdict: false, checks };
  }
  receipts.forEach((receipt, index) => {
    if (index === 0) {
      check(
        checks,
        `chain_${index}`,
        receipt.prev_receipt_hash === null,
        receipt.prev_receipt_hash === null
          ? "First receipt has no previous receipt hash."
          : "First receipt unexpectedly declares a previous receipt hash."
      );
      return;
    }
    const expected = signedDecisionReceiptHash(receipts[index - 1]);
    check(
      checks,
      `chain_${index}`,
      receipt.prev_receipt_hash === expected,
      receipt.prev_receipt_hash === expected
        ? "Previous receipt hash matches prior signed receipt."
        : `Hash-chain break. Expected ${expected}; observed ${receipt.prev_receipt_hash ?? "null"}.`
    );
  });
  return { verdict: checks.every((entry) => entry.passed), checks };
}

function leafHash(leaf) {
  return `sha256:${sha256Hex(canonicalize({
    domain: "ghost-ark.receipt-chain-head.leaf.v1",
    tenantId: leaf.tenantId,
    headHash: leaf.headHash
  }))}`;
}

function merkleParentHash(left, right) {
  return `sha256:${sha256Hex(`ghost-ark.receipt-checkpoint.node.v1:${left}:${right}`)}`;
}

function verifyInclusionProof(proof, expectedRoot) {
  let computed = leafHash(proof.leaf);
  if (computed !== proof.leafHash) {
    return false;
  }
  for (const step of proof.proof ?? []) {
    computed = step.position === "left" ? merkleParentHash(step.hash, computed) : merkleParentHash(computed, step.hash);
  }
  return computed === expectedRoot;
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
  const manifest = args.keyManifest ? readJsonFile(args.keyManifest) : undefined;
  const checks = [];
  let result = { verdict: true, checks };
  let record;

  if (args.verifyChain) {
    const chainResult = verifyDecisionReceiptChain(readJsonFile(args.verifyChain));
    result = {
      verdict: result.verdict && chainResult.verdict,
      checks: [...result.checks, ...chainResult.checks]
    };
  }

  if (args.receipt) {
    record = readJsonFile(args.receipt);
    const isDecisionReceipt = record?.schema_version === "ghost.receipt.v1";
    const keyId = isDecisionReceipt ? parseDecisionEnvelope(record).keyId : record?.signature?.keyId;
    const algorithm = isDecisionReceipt ? record?.signature_alg : record?.signature?.algorithm;
    const publicKeyPem = args.key
      ? fs.readFileSync(args.key, "utf8")
      : publicKeyFromManifest(manifest, keyId, algorithm);
    if (!publicKeyPem) {
      throw new Error("--key is required unless --key-manifest supplies publicKeyPem for the receipt key");
    }
    const receiptResult = isDecisionReceipt
      ? verifyDecisionReceiptRecord(record, publicKeyPem, manifest)
      : verifyRecord(record, publicKeyPem, args.tenant, manifest);
    result = {
      ...receiptResult,
      verdict: result.verdict && receiptResult.verdict,
      checks: [...result.checks, ...receiptResult.checks]
    };
  }

  if (args.inclusionProof) {
    const proof = readJsonFile(args.inclusionProof);
    const checkpoint = args.checkpoint ? readJsonFile(args.checkpoint) : undefined;
    const expectedRoot = checkpoint?.merkleRoot ?? proof.root;
    const inclusionPassed = verifyInclusionProof(proof, expectedRoot);
    check(
      result.checks,
      "inclusion_proof",
      inclusionPassed,
      inclusionPassed
        ? "Merkle inclusion proof reconstructs the checkpoint root."
        : `Merkle inclusion proof did not reconstruct root ${expectedRoot}.`
    );
    if (record?.schema_version === "ghost.receipt.v1") {
      const receiptHeadMatches = signedDecisionReceiptHash(record) === proof.leaf?.headHash;
      check(
        result.checks,
        "inclusion_receipt_head",
        receiptHeadMatches,
        receiptHeadMatches
          ? "Decision receipt hash matches the included chain-head leaf."
          : "Decision receipt hash does not match the included chain-head leaf."
      );
    }
    result.verdict = result.verdict && inclusionPassed && result.checks.every((entry) => entry.passed);
  }

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
