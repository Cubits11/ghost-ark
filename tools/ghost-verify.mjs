#!/usr/bin/env node
import { constants, createHash, createHmac, createPublicKey, createVerify, timingSafeEqual, verify as verifySignature } from "crypto";
import fs from "fs";

const nonClaim =
  "This verifies local artifact shape, canonical digests, signatures, attestations, or Merkle proofs only for the selected mode. It does not prove evidence truth, AI safety, compliance, production readiness, or deployment safety.";

function usage() {
  console.log(`Ghost Ark offline receipt verifier

Usage:
  node tools/ghost-verify.mjs --receipt <receiptRecord.json> [--key <publicKey.pem>] [--tenant <tenantSlug>]
  node tools/ghost-verify.mjs --verify-chain <decisionReceipts.json>
  node tools/ghost-verify.mjs --runtime-attestation <attestation.json> --attestation-policy <policy.json>
  node tools/ghost-verify.mjs --attested-receipt-bundle <bundle.json> --attestation-policy <policy.json>
  node tools/ghost-verify.mjs --witness-checkpoint-consistency-proof <proof.json> --previous-witness-checkpoint <checkpoint.json> --new-witness-checkpoint <checkpoint.json> [--witness-key-manifest <manifest.json>]
  node tools/ghost-verify.mjs --receipt-proof <proof.json>

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
  --runtime-attestation
            Runtime attestation evidence JSON. Local-dev HMAC verification requires --attestation-secret or GHOST_ARK_LOCAL_ATTESTATION_SECRET.
  --attestation-policy
            Runtime attestation policy JSON.
  --attestation-secret
            Local-dev attestation HMAC secret for dev/test verification.
  --attested-receipt-bundle
            Sidecar bundle containing a decision receipt and runtime attestation.
  --attested-checkpoint-bundle
            Sidecar bundle containing an epoch checkpoint and runtime attestation.
  --witness-checkpoint-consistency-proof
            Research witness checkpoint consistency proof JSON.
  --previous-witness-checkpoint
            Previous ghostark.research.witness_checkpoint.v1 checkpoint JSON for consistency verification.
  --new-witness-checkpoint
            New ghostark.research.witness_checkpoint.v1 checkpoint JSON for consistency verification.
  --witness-key-manifest
            Research witness key manifest JSON for checkpoint signature and key-epoch verification.
  --receipt-proof
            Receipt proof JSON. Only local-transcript is implemented; other proof systems fail closed.
  --json    Emit a machine-readable verifier report instead of text.
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
    } else if (arg === "--runtime-attestation") {
      args.runtimeAttestation = next;
      index += 1;
    } else if (arg === "--attestation-policy") {
      args.attestationPolicy = next;
      index += 1;
    } else if (arg === "--attestation-secret") {
      args.attestationSecret = next;
      index += 1;
    } else if (arg === "--attested-receipt-bundle") {
      args.attestedReceiptBundle = next;
      index += 1;
    } else if (arg === "--attested-checkpoint-bundle") {
      args.attestedCheckpointBundle = next;
      index += 1;
    } else if (arg === "--witness-checkpoint-consistency-proof") {
      args.witnessCheckpointConsistencyProof = next;
      index += 1;
    } else if (arg === "--previous-witness-checkpoint") {
      args.previousWitnessCheckpoint = next;
      index += 1;
    } else if (arg === "--new-witness-checkpoint") {
      args.newWitnessCheckpoint = next;
      index += 1;
    } else if (arg === "--witness-key-manifest") {
      args.witnessKeyManifest = next;
      index += 1;
    } else if (arg === "--receipt-proof") {
      args.receiptProof = next;
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    !args.receipt &&
    !args.verifyChain &&
    !args.inclusionProof &&
    !args.runtimeAttestation &&
    !args.attestedReceiptBundle &&
    !args.attestedCheckpointBundle &&
    !args.witnessCheckpointConsistencyProof &&
    !args.receiptProof
  ) {
    throw new Error(
      "At least one of --receipt, --verify-chain, --inclusion-proof, --runtime-attestation, --attested-receipt-bundle, --attested-checkpoint-bundle, --witness-checkpoint-consistency-proof, or --receipt-proof is required"
    );
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

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;
const sha256HexPattern = /^[a-f0-9]{64}$/u;
const identityDigestPattern = /^(sha256|hmac-sha256):[a-f0-9]{64}$/u;
const sha384HexPattern = /^[a-f0-9]{96}$/u;
const runtimeMeasurementKeys = ["pcr0", "pcr1", "pcr2", "pcr3", "pcr4", "pcr8"];
const nitroRequiredMeasurementKeys = ["pcr0", "pcr1", "pcr2"];
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const devOnlyBackendMetadataKeys = new Set(["transcriptWitnessDigest", "devOnly", "notZeroKnowledge"]);

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

function validateDecisionReceiptShape(receipt) {
  if (!isRecord(receipt)) {
    return "Receipt must be an object.";
  }
  if (receipt.schema_version !== "ghost.receipt.v1") {
    return "Decision receipt must contain schema_version ghost.receipt.v1.";
  }
  if (typeof receipt.receipt_id !== "string" || !/^grct_[a-f0-9]{64}$/u.test(receipt.receipt_id)) {
    return "Decision receipt has an invalid receipt_id.";
  }
  if (typeof receipt.tenant_id_hash !== "string" || !identityDigestPattern.test(receipt.tenant_id_hash)) {
    return "Decision receipt has an invalid tenant_id_hash.";
  }
  if (typeof receipt.timestamp !== "string" || !Number.isFinite(Date.parse(receipt.timestamp))) {
    return "Decision receipt has an invalid timestamp.";
  }
  if (receipt.prev_receipt_hash !== null && (typeof receipt.prev_receipt_hash !== "string" || !sha256DigestPattern.test(receipt.prev_receipt_hash))) {
    return "Decision receipt has an invalid prev_receipt_hash.";
  }
  if (typeof receipt.receipt_signature !== "string" || receipt.receipt_signature.length === 0) {
    return "Decision receipt has an empty receipt_signature.";
  }
  return null;
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
  if (receipts.length === 0) {
    check(checks, "chain_schema", false, "Chain file must contain at least one decision receipt.");
    return { verdict: false, checks };
  }
  const firstTenant = isRecord(receipts[0]) ? receipts[0].tenant_id_hash : undefined;
  const seenHashes = new Set();
  receipts.forEach((receipt, index) => {
    const shapeError = validateDecisionReceiptShape(receipt);
    if (shapeError) {
      check(checks, `chain_${index}`, false, shapeError);
      return;
    }
    if (typeof firstTenant === "string" && receipt.tenant_id_hash !== firstTenant) {
      check(
        checks,
        `chain_${index}`,
        false,
        `Tenant-chain break. Expected tenant ${firstTenant}; observed ${receipt.tenant_id_hash}.`
      );
      return;
    }
    const currentHash = signedDecisionReceiptHash(receipt);
    if (seenHashes.has(currentHash)) {
      check(checks, `chain_${index}`, false, `Duplicate signed receipt hash observed: ${currentHash}.`);
      return;
    }
    seenHashes.add(currentHash);
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
    const previous = receipts[index - 1];
    const previousShapeError = validateDecisionReceiptShape(previous);
    if (previousShapeError) {
      check(checks, `chain_${index}`, false, "Cannot verify receipt chain continuity because the prior receipt is invalid.");
      return;
    }
    if (Date.parse(receipt.timestamp) < Date.parse(previous.timestamp)) {
      check(
        checks,
        `chain_${index}`,
        false,
        `Receipt timestamp ${receipt.timestamp} is earlier than prior receipt timestamp ${previous.timestamp}.`
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
  if (!validateInclusionProofShape(proof, expectedRoot).passed) {
    return false;
  }
  let computed = leafHash(proof.leaf);
  if (computed !== proof.leafHash) {
    return false;
  }
  for (const step of proof.proof ?? []) {
    computed = step.position === "left" ? merkleParentHash(step.hash, computed) : merkleParentHash(computed, step.hash);
  }
  return computed === expectedRoot;
}

const researchEmptyTreeRoot = sha256Hex("ghostark.empty_merkle_tree.v1");

function researchMerkleParentHash(left, right) {
  return sha256Hex(`ghostark.node.v1:${left}:${right}`);
}

function largestPowerOfTwoLessThan(value) {
  if (!Number.isSafeInteger(value) || value <= 1) {
    throw new Error("value must be a safe integer greater than one");
  }
  let power = 1;
  while (power * 2 < value) {
    power *= 2;
  }
  return power;
}

function validateResearchWitnessCheckpointShape(checkpoint, label) {
  if (!isRecord(checkpoint)) {
    return { passed: false, detail: `${label} witness checkpoint must be an object.` };
  }
  const unknown = exactKeys(checkpoint, [
    "schema_version",
    "log_id",
    "tree_size",
    "root_hash",
    "integrated_time",
    "witness_signatures"
  ]);
  if (unknown.length > 0) {
    return { passed: false, detail: `${label} witness checkpoint contains unknown fields: ${unknown.join(", ")}.` };
  }
  if (checkpoint.schema_version !== "ghostark.research.witness_checkpoint.v1") {
    return { passed: false, detail: `${label} witness checkpoint schema_version must be ghostark.research.witness_checkpoint.v1.` };
  }
  if (typeof checkpoint.log_id !== "string" || checkpoint.log_id.length === 0) {
    return { passed: false, detail: `${label} witness checkpoint log_id must be a non-empty string.` };
  }
  if (!Number.isSafeInteger(checkpoint.tree_size) || checkpoint.tree_size < 0) {
    return { passed: false, detail: `${label} witness checkpoint tree_size must be a non-negative safe integer.` };
  }
  if (typeof checkpoint.root_hash !== "string" || !sha256HexPattern.test(checkpoint.root_hash)) {
    return { passed: false, detail: `${label} witness checkpoint root_hash must be a lowercase SHA-256 hex digest.` };
  }
  if (typeof checkpoint.integrated_time !== "string" || !Number.isFinite(Date.parse(checkpoint.integrated_time))) {
    return { passed: false, detail: `${label} witness checkpoint integrated_time must be a valid date-time.` };
  }
  if (!Array.isArray(checkpoint.witness_signatures) || checkpoint.witness_signatures.length === 0) {
    return { passed: false, detail: `${label} witness checkpoint witness_signatures must contain at least one signature.` };
  }
  for (const [index, signature] of checkpoint.witness_signatures.entries()) {
    if (
      !isRecord(signature) ||
      typeof signature.witness_id !== "string" ||
      signature.witness_id.length === 0 ||
      !["ed25519", "ecdsa-p256-sha256", "kms-ecdsa-sha256"].includes(signature.signature_algorithm) ||
      typeof signature.signature !== "string" ||
      signature.signature.length === 0
    ) {
      return { passed: false, detail: `${label} witness checkpoint signature ${index} is malformed.` };
    }
  }
  return { passed: true, detail: `${label} witness checkpoint shape is valid.` };
}

function validateResearchWitnessConsistencyProofShape(proof) {
  if (!isRecord(proof)) {
    return { passed: false, detail: "Witness checkpoint consistency proof must be an object." };
  }
  const unknown = exactKeys(proof, [
    "schema_version",
    "log_id",
    "old_tree_size",
    "new_tree_size",
    "old_root_hash",
    "new_root_hash",
    "audit_path"
  ]);
  if (unknown.length > 0) {
    return { passed: false, detail: `Witness checkpoint consistency proof contains unknown fields: ${unknown.join(", ")}.` };
  }
  if (proof.schema_version !== "ghostark.research.witness_checkpoint_consistency_proof.v1") {
    return {
      passed: false,
      detail: "Witness checkpoint consistency proof schema_version must be ghostark.research.witness_checkpoint_consistency_proof.v1."
    };
  }
  if (typeof proof.log_id !== "string" || proof.log_id.length === 0) {
    return { passed: false, detail: "Witness checkpoint consistency proof log_id must be a non-empty string." };
  }
  if (!Number.isSafeInteger(proof.old_tree_size) || proof.old_tree_size < 0) {
    return { passed: false, detail: "Witness checkpoint consistency proof old_tree_size must be a non-negative safe integer." };
  }
  if (!Number.isSafeInteger(proof.new_tree_size) || proof.new_tree_size < 0) {
    return { passed: false, detail: "Witness checkpoint consistency proof new_tree_size must be a non-negative safe integer." };
  }
  if (typeof proof.old_root_hash !== "string" || !sha256HexPattern.test(proof.old_root_hash)) {
    return { passed: false, detail: "Witness checkpoint consistency proof old_root_hash must be a lowercase SHA-256 hex digest." };
  }
  if (typeof proof.new_root_hash !== "string" || !sha256HexPattern.test(proof.new_root_hash)) {
    return { passed: false, detail: "Witness checkpoint consistency proof new_root_hash must be a lowercase SHA-256 hex digest." };
  }
  if (!Array.isArray(proof.audit_path)) {
    return { passed: false, detail: "Witness checkpoint consistency proof audit_path must be an array." };
  }
  for (const [index, hash] of proof.audit_path.entries()) {
    if (typeof hash !== "string" || !sha256HexPattern.test(hash)) {
      return { passed: false, detail: `Witness checkpoint consistency proof audit_path entry ${index} must be a lowercase SHA-256 hex digest.` };
    }
  }
  return { passed: true, detail: "Witness checkpoint consistency proof shape is valid." };
}

function validateResearchWitnessKeyManifestShape(manifest) {
  if (!isRecord(manifest)) {
    return { passed: false, detail: "Witness key manifest must be an object." };
  }
  const unknown = exactKeys(manifest, ["schema_version", "generated_at", "witnesses"]);
  if (unknown.length > 0) {
    return { passed: false, detail: `Witness key manifest contains unknown fields: ${unknown.join(", ")}.` };
  }
  if (manifest.schema_version !== "ghostark.research.witness_key_manifest.v1") {
    return { passed: false, detail: "Witness key manifest schema_version must be ghostark.research.witness_key_manifest.v1." };
  }
  if (typeof manifest.generated_at !== "string" || !Number.isFinite(Date.parse(manifest.generated_at))) {
    return { passed: false, detail: "Witness key manifest generated_at must be a valid date-time." };
  }
  if (!Array.isArray(manifest.witnesses) || manifest.witnesses.length === 0) {
    return { passed: false, detail: "Witness key manifest witnesses must contain at least one entry." };
  }

  const seen = new Set();
  for (const [index, witness] of manifest.witnesses.entries()) {
    if (!isRecord(witness)) {
      return { passed: false, detail: `Witness key manifest entry ${index} must be an object.` };
    }
    const entryUnknown = exactKeys(witness, [
      "witness_id",
      "signature_algorithm",
      "public_key_pem",
      "valid_from",
      "valid_until",
      "status",
      "revoked_at",
      "reason"
    ]);
    if (entryUnknown.length > 0) {
      return { passed: false, detail: `Witness key manifest entry ${index} contains unknown fields: ${entryUnknown.join(", ")}.` };
    }
    if (typeof witness.witness_id !== "string" || witness.witness_id.length === 0) {
      return { passed: false, detail: `Witness key manifest entry ${index} witness_id must be a non-empty string.` };
    }
    if (witness.signature_algorithm !== "ecdsa-p256-sha256") {
      return { passed: false, detail: `Witness key manifest entry ${index} signature_algorithm is unsupported.` };
    }
    if (typeof witness.public_key_pem !== "string" || witness.public_key_pem.length === 0) {
      return { passed: false, detail: `Witness key manifest entry ${index} public_key_pem must be a non-empty string.` };
    }
    if (typeof witness.valid_from !== "string" || !Number.isFinite(Date.parse(witness.valid_from))) {
      return { passed: false, detail: `Witness key manifest entry ${index} valid_from must be a valid date-time.` };
    }
    if (witness.valid_until !== undefined && (typeof witness.valid_until !== "string" || !Number.isFinite(Date.parse(witness.valid_until)))) {
      return { passed: false, detail: `Witness key manifest entry ${index} valid_until must be a valid date-time.` };
    }
    if (!["ACTIVE", "DEPRECATED", "REVOKED"].includes(witness.status)) {
      return { passed: false, detail: `Witness key manifest entry ${index} status is unsupported.` };
    }
    if (witness.revoked_at !== undefined && (typeof witness.revoked_at !== "string" || !Number.isFinite(Date.parse(witness.revoked_at)))) {
      return { passed: false, detail: `Witness key manifest entry ${index} revoked_at must be a valid date-time.` };
    }
    const validFrom = Date.parse(witness.valid_from);
    const validUntil = witness.valid_until ? Date.parse(witness.valid_until) : undefined;
    const revokedAt = witness.revoked_at ? Date.parse(witness.revoked_at) : undefined;
    if (validUntil !== undefined && validUntil <= validFrom) {
      return { passed: false, detail: `Witness key manifest entry ${index} valid_until must be later than valid_from.` };
    }
    if (revokedAt !== undefined && revokedAt < validFrom) {
      return { passed: false, detail: `Witness key manifest entry ${index} revoked_at cannot be earlier than valid_from.` };
    }
    const identity = `${witness.witness_id}:${witness.signature_algorithm}`;
    if (seen.has(identity)) {
      return { passed: false, detail: `Duplicate witness key manifest entry for ${identity}.` };
    }
    seen.add(identity);
  }

  return { passed: true, detail: "Witness key manifest shape is valid." };
}

function findResearchWitnessManifestEntry(manifest, witnessId, signatureAlgorithm) {
  return (
    manifest?.witnesses?.find((entry) => entry.witness_id === witnessId && entry.signature_algorithm === signatureAlgorithm) ??
    manifest?.witnesses?.find((entry) => entry.witness_id === witnessId) ??
    null
  );
}

function verifyResearchWitnessKeyManifestEpoch(manifest, signature, integratedTime) {
  const shape = validateResearchWitnessKeyManifestShape(manifest);
  if (!shape.passed) {
    return { passed: false, detail: `Witness key manifest is invalid: ${shape.detail}` };
  }
  const entry = findResearchWitnessManifestEntry(manifest, signature.witness_id, signature.signature_algorithm);
  if (!entry) {
    return { passed: false, detail: `No witness key manifest entry exists for witness ${signature.witness_id}.` };
  }
  if (entry.signature_algorithm !== signature.signature_algorithm) {
    return {
      passed: false,
      detail: `Witness algorithm mismatch. Expected ${entry.signature_algorithm}; observed ${signature.signature_algorithm}.`
    };
  }
  const observed = Date.parse(integratedTime);
  const validFrom = Date.parse(entry.valid_from);
  const validUntil = entry.valid_until ? Date.parse(entry.valid_until) : Number.POSITIVE_INFINITY;
  const revokedAt = entry.revoked_at ? Date.parse(entry.revoked_at) : undefined;
  if (!Number.isFinite(observed)) {
    return { passed: false, detail: `Checkpoint integrated_time is not parseable: ${integratedTime}.` };
  }
  if (observed < validFrom) {
    return { passed: false, detail: `Checkpoint integrated_time ${integratedTime} is before witness valid_from ${entry.valid_from}.` };
  }
  if (observed >= validUntil) {
    return { passed: false, detail: `Checkpoint integrated_time ${integratedTime} is not before witness valid_until ${entry.valid_until}.` };
  }
  if (entry.status === "REVOKED" && revokedAt === undefined) {
    return { passed: false, detail: `Witness ${entry.witness_id} is revoked without a revoked_at timestamp.` };
  }
  if (revokedAt !== undefined && observed >= revokedAt) {
    return { passed: false, detail: `Checkpoint integrated_time ${integratedTime} is at or after witness revoked_at ${entry.revoked_at}.` };
  }
  return {
    passed: true,
    detail:
      entry.status === "REVOKED"
        ? `Witness ${entry.witness_id} was revoked after this historical checkpoint.`
        : `Witness ${entry.witness_id} is ${entry.status} for the checkpoint integrated_time.`
  };
}

function canonicalResearchWitnessCheckpointPayload(checkpoint) {
  return JSON.stringify({
    integrated_time: checkpoint.integrated_time,
    log_id: checkpoint.log_id,
    root_hash: checkpoint.root_hash,
    schema_version: checkpoint.schema_version,
    tree_size: checkpoint.tree_size
  });
}

function verifyResearchWitnessCheckpointSignatures(checkpoint, manifest, label) {
  const manifestShape = validateResearchWitnessKeyManifestShape(manifest);
  if (!manifestShape.passed) {
    return { passed: false, detail: manifestShape.detail };
  }

  const payload = canonicalResearchWitnessCheckpointPayload(checkpoint);
  for (const [index, signature] of checkpoint.witness_signatures.entries()) {
    const epoch = verifyResearchWitnessKeyManifestEpoch(manifest, signature, checkpoint.integrated_time);
    if (!epoch.passed) {
      return { passed: false, detail: `${label} checkpoint signature ${index}: ${epoch.detail}` };
    }
    const entry = findResearchWitnessManifestEntry(manifest, signature.witness_id, signature.signature_algorithm);
    if (!entry) {
      return { passed: false, detail: `${label} checkpoint signature ${index}: witness key entry disappeared after epoch validation.` };
    }
    try {
      const verifier = createVerify("sha256");
      verifier.update(payload);
      verifier.end();
      if (!verifier.verify(createPublicKey(entry.public_key_pem), signature.signature, "base64")) {
        return { passed: false, detail: `${label} checkpoint signature ${index} does not verify with manifest witness key ${entry.witness_id}.` };
      }
    } catch (error) {
      return { passed: false, detail: `${label} checkpoint signature ${index}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  return { passed: true, detail: `${label} checkpoint witness signatures verify against the witness key manifest.` };
}

function verifyResearchConsistencySubproof(state) {
  if (state.oldTreeSize === state.newTreeSize) {
    if (state.includeOldRoot) {
      return {
        cursor: state.cursor,
        oldRootHash: state.oldRootHash,
        newRootHash: state.oldRootHash
      };
    }
    const rootHash = state.auditPath[state.cursor];
    if (rootHash === undefined) {
      return null;
    }
    return {
      cursor: state.cursor + 1,
      oldRootHash: rootHash,
      newRootHash: rootHash
    };
  }

  const splitSize = largestPowerOfTwoLessThan(state.newTreeSize);
  if (state.oldTreeSize <= splitSize) {
    const left = verifyResearchConsistencySubproof({
      oldTreeSize: state.oldTreeSize,
      newTreeSize: splitSize,
      includeOldRoot: state.includeOldRoot,
      auditPath: state.auditPath,
      cursor: state.cursor,
      oldRootHash: state.oldRootHash
    });
    if (left === null) {
      return null;
    }
    const rightHash = state.auditPath[left.cursor];
    if (rightHash === undefined) {
      return null;
    }
    return {
      cursor: left.cursor + 1,
      oldRootHash: left.oldRootHash,
      newRootHash: researchMerkleParentHash(left.newRootHash, rightHash)
    };
  }

  const right = verifyResearchConsistencySubproof({
    oldTreeSize: state.oldTreeSize - splitSize,
    newTreeSize: state.newTreeSize - splitSize,
    includeOldRoot: false,
    auditPath: state.auditPath,
    cursor: state.cursor,
    oldRootHash: state.oldRootHash
  });
  if (right === null) {
    return null;
  }
  const leftHash = state.auditPath[right.cursor];
  if (leftHash === undefined) {
    return null;
  }
  return {
    cursor: right.cursor + 1,
    oldRootHash: researchMerkleParentHash(leftHash, right.oldRootHash),
    newRootHash: researchMerkleParentHash(leftHash, right.newRootHash)
  };
}

function verifyResearchMerkleConsistencyProof(proof) {
  if (!validateResearchWitnessConsistencyProofShape(proof).passed) {
    return false;
  }
  if (proof.old_tree_size > proof.new_tree_size) {
    return false;
  }
  if (proof.old_tree_size === 0) {
    return proof.old_root_hash === researchEmptyTreeRoot && proof.audit_path.length === 0;
  }
  if (proof.old_tree_size === proof.new_tree_size) {
    return proof.audit_path.length === 0 && proof.old_root_hash === proof.new_root_hash;
  }
  const reconstructed = verifyResearchConsistencySubproof({
    oldTreeSize: proof.old_tree_size,
    newTreeSize: proof.new_tree_size,
    includeOldRoot: true,
    auditPath: proof.audit_path,
    cursor: 0,
    oldRootHash: proof.old_root_hash
  });
  return (
    reconstructed !== null &&
    reconstructed.cursor === proof.audit_path.length &&
    reconstructed.oldRootHash === proof.old_root_hash &&
    reconstructed.newRootHash === proof.new_root_hash
  );
}

function verifyResearchWitnessCheckpointConsistency(previousCheckpoint, newCheckpoint, proof, witnessKeyManifest) {
  const checks = [];
  const previousShape = validateResearchWitnessCheckpointShape(previousCheckpoint, "Previous");
  const newShape = validateResearchWitnessCheckpointShape(newCheckpoint, "New");
  const proofShape = validateResearchWitnessConsistencyProofShape(proof);
  check(checks, "witness_previous_checkpoint_schema", previousShape.passed, previousShape.detail);
  check(checks, "witness_new_checkpoint_schema", newShape.passed, newShape.detail);
  check(checks, "witness_consistency_proof_schema", proofShape.passed, proofShape.detail);
  if (witnessKeyManifest) {
    const manifestShape = validateResearchWitnessKeyManifestShape(witnessKeyManifest);
    check(checks, "witness_key_manifest_schema", manifestShape.passed, manifestShape.detail);
  } else {
    check(
      checks,
      "witness_key_manifest",
      true,
      "No witness key manifest supplied; witness checkpoint signatures were not checked."
    );
  }

  if (!checks.every((entry) => entry.passed)) {
    return { verdict: false, checks };
  }

  const metadataMatches =
    previousCheckpoint.log_id === newCheckpoint.log_id &&
    proof.log_id === previousCheckpoint.log_id &&
    proof.old_tree_size === previousCheckpoint.tree_size &&
    proof.new_tree_size === newCheckpoint.tree_size &&
    proof.old_root_hash === previousCheckpoint.root_hash &&
    proof.new_root_hash === newCheckpoint.root_hash;
  check(
    checks,
    "witness_consistency_metadata",
    metadataMatches,
    metadataMatches
      ? "Consistency proof metadata matches both witness checkpoints."
      : "Consistency proof metadata does not match the supplied witness checkpoints."
  );

  const previousTime = Date.parse(previousCheckpoint.integrated_time);
  const newTime = Date.parse(newCheckpoint.integrated_time);
  const timeOrderValid = previousTime <= newTime;
  check(
    checks,
    "witness_checkpoint_time_order",
    timeOrderValid,
    timeOrderValid
      ? "New checkpoint integrated_time is not earlier than the previous checkpoint."
      : "New checkpoint integrated_time is earlier than the previous checkpoint."
  );

  const merklePassed = metadataMatches && verifyResearchMerkleConsistencyProof(proof);
  check(
    checks,
    "witness_consistency_proof",
    merklePassed,
    merklePassed
      ? "Witness checkpoint consistency proof reconstructs the new root from the previous root."
      : "Witness checkpoint consistency proof does not reconstruct the supplied checkpoint roots."
  );

  if (witnessKeyManifest) {
    const previousSignatures = verifyResearchWitnessCheckpointSignatures(
      previousCheckpoint,
      witnessKeyManifest,
      "Previous"
    );
    const newSignatures = verifyResearchWitnessCheckpointSignatures(
      newCheckpoint,
      witnessKeyManifest,
      "New"
    );
    check(
      checks,
      "witness_previous_checkpoint_signatures",
      previousSignatures.passed,
      previousSignatures.detail
    );
    check(
      checks,
      "witness_new_checkpoint_signatures",
      newSignatures.passed,
      newSignatures.detail
    );
  }

  return { verdict: checks.every((entry) => entry.passed), checks };
}

function validateInclusionProofShape(proof, expectedRoot) {
  if (!isRecord(proof)) {
    return { passed: false, detail: "Inclusion proof must be an object." };
  }
  if (!isRecord(proof.leaf)) {
    return { passed: false, detail: "Inclusion proof leaf must be an object." };
  }
  if (typeof proof.leaf.tenantId !== "string" || !identityDigestPattern.test(proof.leaf.tenantId)) {
    return { passed: false, detail: "Inclusion proof leaf tenantId must be a sha256 or hmac-sha256 digest." };
  }
  if (typeof proof.leaf.headHash !== "string" || !sha256DigestPattern.test(proof.leaf.headHash)) {
    return { passed: false, detail: "Inclusion proof leaf headHash must be a sha256 digest." };
  }
  if (typeof proof.leafHash !== "string" || !sha256DigestPattern.test(proof.leafHash)) {
    return { passed: false, detail: "Inclusion proof leafHash must be a sha256 digest." };
  }
  if (typeof expectedRoot !== "string" || !sha256DigestPattern.test(expectedRoot)) {
    return { passed: false, detail: "Inclusion proof root must be a sha256 digest." };
  }
  if (!Array.isArray(proof.proof)) {
    return { passed: false, detail: "Inclusion proof proof field must be an array." };
  }
  for (const [index, step] of proof.proof.entries()) {
    if (!isRecord(step) || !["left", "right"].includes(step.position) || typeof step.hash !== "string" || !sha256DigestPattern.test(step.hash)) {
      return { passed: false, detail: `Inclusion proof step ${index} is malformed.` };
    }
  }
  return { passed: true, detail: "Inclusion proof shape is valid." };
}

function exactKeys(value, allowedKeys) {
  return Object.keys(value).filter((key) => !allowedKeys.includes(key));
}

function validateRuntimeAttestationShape(attestation) {
  if (!isRecord(attestation)) {
    return { passed: false, detail: "Runtime attestation must be an object." };
  }
  const unknown = exactKeys(attestation, [
    "schemaVersion",
    "attestationType",
    "attestationId",
    "subjectDigest",
    "issuedAt",
    "runtime",
    "measurements",
    "binding",
    "signature"
  ]);
  if (unknown.length > 0) {
    return { passed: false, detail: `Runtime attestation contains unknown fields: ${unknown.join(", ")}.` };
  }
  if (attestation.schemaVersion !== "ghost.runtime_attestation.v1") {
    return { passed: false, detail: "Runtime attestation schemaVersion must be ghost.runtime_attestation.v1." };
  }
  if (!["local-dev-attestation", "aws-nitro-enclave"].includes(attestation.attestationType)) {
    return { passed: false, detail: `Unsupported attestation type ${attestation.attestationType ?? "missing"}.` };
  }
  if (typeof attestation.attestationId !== "string" || attestation.attestationId.length === 0) {
    return { passed: false, detail: "Runtime attestation attestationId must be a non-empty string." };
  }
  if (typeof attestation.subjectDigest !== "string" || !sha256DigestPattern.test(attestation.subjectDigest)) {
    return { passed: false, detail: "Runtime attestation subjectDigest must be a sha256 digest." };
  }
  if (typeof attestation.issuedAt !== "string" || !Number.isFinite(Date.parse(attestation.issuedAt))) {
    return { passed: false, detail: "Runtime attestation issuedAt must be a valid date-time." };
  }
  if (!isRecord(attestation.runtime)) {
    return { passed: false, detail: "Runtime attestation runtime must be an object." };
  }
  const runtimeUnknown = exactKeys(attestation.runtime, ["runtimeId", "imageDigest", "codeDigest", "policyCompilerDigest"]);
  if (runtimeUnknown.length > 0) {
    return { passed: false, detail: `Runtime identity contains unknown fields: ${runtimeUnknown.join(", ")}.` };
  }
  if (typeof attestation.runtime.runtimeId !== "string" || attestation.runtime.runtimeId.length === 0) {
    return { passed: false, detail: "Runtime identity runtimeId must be non-empty." };
  }
  for (const field of ["imageDigest", "codeDigest", "policyCompilerDigest"]) {
    if (typeof attestation.runtime[field] !== "string" || !sha256DigestPattern.test(attestation.runtime[field])) {
      return { passed: false, detail: `Runtime identity ${field} must be a sha256 digest.` };
    }
  }
  if (attestation.measurements !== undefined) {
    if (!isRecord(attestation.measurements)) {
      return { passed: false, detail: "Runtime attestation measurements must be an object when supplied." };
    }
    const measurementUnknown = exactKeys(attestation.measurements, ["pcr0", "pcr1", "pcr2", "pcr3", "pcr4", "pcr8"]);
    if (measurementUnknown.length > 0) {
      return { passed: false, detail: `Runtime measurements contain unknown fields: ${measurementUnknown.join(", ")}.` };
    }
    for (const [key, value] of Object.entries(attestation.measurements)) {
      if (typeof value !== "string" || value.length === 0) {
        return { passed: false, detail: `Runtime measurement ${key} must be a non-empty string.` };
      }
    }
  }
  if (!isRecord(attestation.binding)) {
    return { passed: false, detail: "Runtime attestation binding must be an object." };
  }
  const bindingUnknown = exactKeys(attestation.binding, ["receiptHash", "checkpointDigest", "payloadDigest"]);
  if (bindingUnknown.length > 0) {
    return { passed: false, detail: `Runtime binding contains unknown fields: ${bindingUnknown.join(", ")}.` };
  }
  if (!attestation.binding.receiptHash && !attestation.binding.checkpointDigest && !attestation.binding.payloadDigest) {
    return { passed: false, detail: "Runtime attestation binding must include at least one digest." };
  }
  for (const field of ["receiptHash", "checkpointDigest", "payloadDigest"]) {
    if (attestation.binding[field] !== undefined && (typeof attestation.binding[field] !== "string" || !sha256DigestPattern.test(attestation.binding[field]))) {
      return { passed: false, detail: `Runtime binding ${field} must be a sha256 digest.` };
    }
  }
  if (!isRecord(attestation.signature)) {
    return { passed: false, detail: "Runtime attestation signature must be an object." };
  }
  const signatureUnknown = exactKeys(attestation.signature, ["algorithm", "value", "publicKeyPem"]);
  if (signatureUnknown.length > 0) {
    return { passed: false, detail: `Runtime signature contains unknown fields: ${signatureUnknown.join(", ")}.` };
  }
  if (!["hmac-sha256", "ecdsa-sha256", "rsa-sha256", "aws-nitro-attestation"].includes(attestation.signature.algorithm)) {
    return { passed: false, detail: `Unsupported runtime attestation signature algorithm ${attestation.signature.algorithm ?? "missing"}.` };
  }
  if (typeof attestation.signature.value !== "string" || attestation.signature.value.length === 0) {
    return { passed: false, detail: "Runtime attestation signature value must be non-empty." };
  }
  if (attestation.signature.publicKeyPem !== undefined && typeof attestation.signature.publicKeyPem !== "string") {
    return { passed: false, detail: "Runtime attestation publicKeyPem must be a string when supplied." };
  }
  return { passed: true, detail: "Runtime attestation shape is valid." };
}

function validateRuntimeAttestationPolicyShape(policy) {
  if (!isRecord(policy)) {
    return { passed: false, detail: "Runtime attestation policy must be an object." };
  }
  const unknown = exactKeys(policy, [
    "schemaVersion",
    "allowedTypes",
    "requiredRuntimeIds",
    "allowedImageDigests",
    "allowedCodeDigests",
    "allowedPolicyCompilerDigests",
    "requiredMeasurements",
    "maxClockSkewMs",
    "requireBindingToReceipt",
    "requireBindingToCheckpoint",
    "requireBindingToPayload"
  ]);
  if (unknown.length > 0) {
    return { passed: false, detail: `Runtime attestation policy contains unknown fields: ${unknown.join(", ")}.` };
  }
  if (policy.schemaVersion !== "ghost.runtime_attestation_policy.v1") {
    return { passed: false, detail: "Runtime attestation policy schemaVersion must be ghost.runtime_attestation_policy.v1." };
  }
  if (!Array.isArray(policy.allowedTypes) || policy.allowedTypes.length === 0) {
    return { passed: false, detail: "Runtime attestation policy allowedTypes must be a non-empty array." };
  }
  if (!policy.allowedTypes.every((type) => ["local-dev-attestation", "aws-nitro-enclave"].includes(type))) {
    return { passed: false, detail: "Runtime attestation policy allowedTypes contains an unsupported type." };
  }
  for (const field of ["allowedImageDigests", "allowedCodeDigests", "allowedPolicyCompilerDigests"]) {
    if (policy[field] !== undefined && (!Array.isArray(policy[field]) || !policy[field].every((digest) => typeof digest === "string" && sha256DigestPattern.test(digest)))) {
      return { passed: false, detail: `Runtime attestation policy ${field} must contain sha256 digests.` };
    }
  }
  if (policy.requiredRuntimeIds !== undefined && (!Array.isArray(policy.requiredRuntimeIds) || !policy.requiredRuntimeIds.every((item) => typeof item === "string" && item.length > 0))) {
    return { passed: false, detail: "Runtime attestation policy requiredRuntimeIds must contain non-empty strings." };
  }
  if (policy.requiredMeasurements !== undefined) {
    if (!isRecord(policy.requiredMeasurements)) {
      return { passed: false, detail: "Runtime attestation policy requiredMeasurements must be an object." };
    }
    const measurementUnknown = exactKeys(policy.requiredMeasurements, runtimeMeasurementKeys);
    if (measurementUnknown.length > 0) {
      return { passed: false, detail: `Runtime attestation policy requiredMeasurements contains unknown fields: ${measurementUnknown.join(", ")}.` };
    }
    for (const key of runtimeMeasurementKeys) {
      const values = policy.requiredMeasurements[key];
      if (values !== undefined && (!Array.isArray(values) || values.length === 0 || !values.every((item) => typeof item === "string" && item.length > 0))) {
        return { passed: false, detail: `Runtime attestation policy requiredMeasurements.${key} must contain non-empty strings.` };
      }
    }
  }
  if (policy.maxClockSkewMs !== undefined && (!Number.isInteger(policy.maxClockSkewMs) || policy.maxClockSkewMs < 0)) {
    return { passed: false, detail: "Runtime attestation policy maxClockSkewMs must be a non-negative integer." };
  }
  return { passed: true, detail: "Runtime attestation policy shape is valid." };
}

function runtimeAttestationSubjectDigest(attestation) {
  return `sha256:${sha256Hex(canonicalize({
    schemaVersion: "ghost.runtime_attestation.subject.v1",
    attestationType: attestation.attestationType,
    issuedAt: attestation.issuedAt,
    runtime: attestation.runtime,
    binding: attestation.binding,
    measurements: attestation.measurements ?? {}
  }))}`;
}

function localRuntimeAttestationSignaturePayloadDigest(attestation) {
  return `sha256:${sha256Hex(canonicalize({
    schemaVersion: "ghost.local_runtime_attestation.signature_payload.v1",
    attestationType: attestation.attestationType,
    subjectDigest: attestation.subjectDigest,
    issuedAt: attestation.issuedAt,
    runtime: attestation.runtime,
    binding: attestation.binding,
    measurements: attestation.measurements ?? {}
  }))}`;
}

function localRuntimeAttestationSignature(secret, attestation) {
  const payloadDigest = localRuntimeAttestationSignaturePayloadDigest(attestation);
  return `hmac-sha256:${createHmac("sha256", secret).update(payloadDigest).digest("hex")}`;
}

function constantTimeStringEquals(left, right) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function listAllows(list, observed) {
  return list === undefined || list.includes(observed);
}

function expectedAlgorithmForAttestationType(attestationType) {
  return attestationType === "aws-nitro-enclave" ? "aws-nitro-attestation" : "hmac-sha256";
}

function requiredMeasurementEntries(policy) {
  return runtimeMeasurementKeys.flatMap((key) => {
    const values = policy.requiredMeasurements?.[key];
    return values && values.length > 0 ? [[key, values]] : [];
  });
}

function measurementPolicyFailures(attestation, policy) {
  return requiredMeasurementEntries(policy).flatMap(([key, allowedValues]) => {
    const observed = attestation.measurements?.[key];
    if (!observed) {
      return [`${key} missing from attestation evidence`];
    }
    if (!allowedValues.includes(observed)) {
      return [`${key} mismatch`];
    }
    return [];
  });
}

function nitroPcrPolicyFailures(attestation, policy) {
  const failures = [];
  const measurements = attestation.measurements ?? {};
  const requiredMeasurements = policy.requiredMeasurements ?? {};

  for (const key of nitroRequiredMeasurementKeys) {
    const pinnedValues = requiredMeasurements[key] ?? [];
    const observed = measurements[key];
    if (pinnedValues.length === 0) {
      failures.push(`${key} is not pinned by policy`);
    }
    if (!observed) {
      failures.push(`${key} missing from Nitro evidence`);
    } else if (!sha384HexPattern.test(observed)) {
      failures.push(`${key} must be a lowercase SHA-384 PCR value`);
    }
    for (const pinnedValue of pinnedValues) {
      if (!sha384HexPattern.test(pinnedValue)) {
        failures.push(`${key} policy pin must be a lowercase SHA-384 PCR value`);
      }
    }
    if (observed && pinnedValues.length > 0 && !pinnedValues.includes(observed)) {
      failures.push(`${key} does not match policy pin`);
    }
  }

  return failures;
}

function verifyRuntimeAttestationCli(attestation, policy, options = {}) {
  const checks = [];
  const attestationShape = validateRuntimeAttestationShape(attestation);
  check(checks, "runtime_attestation_schema", attestationShape.passed, attestationShape.detail);
  const policyShape = validateRuntimeAttestationPolicyShape(policy);
  check(checks, "runtime_attestation_policy", policyShape.passed, policyShape.detail);
  if (!attestationShape.passed || !policyShape.passed) {
    return { verdict: false, checks };
  }

  check(
    checks,
    "runtime_attestation_type",
    policy.allowedTypes.includes(attestation.attestationType),
    policy.allowedTypes.includes(attestation.attestationType)
      ? `Attestation type ${attestation.attestationType} is allowed.`
      : `Attestation type ${attestation.attestationType} is not allowed.`
  );
  const expectedSubjectDigest = runtimeAttestationSubjectDigest(attestation);
  check(
    checks,
    "runtime_attestation_subject_digest",
    attestation.subjectDigest === expectedSubjectDigest,
    attestation.subjectDigest === expectedSubjectDigest
      ? "Subject digest matches the domain-separated canonical attestation subject."
      : `Subject digest mismatch. Expected ${expectedSubjectDigest}; observed ${attestation.subjectDigest}.`
  );
  check(
    checks,
    "runtime_attestation_runtime_id",
    listAllows(policy.requiredRuntimeIds, attestation.runtime.runtimeId),
    listAllows(policy.requiredRuntimeIds, attestation.runtime.runtimeId)
      ? `Runtime id ${attestation.runtime.runtimeId} is allowed.`
      : `Runtime id ${attestation.runtime.runtimeId} is not allowed.`
  );
  check(
    checks,
    "runtime_attestation_image_digest",
    listAllows(policy.allowedImageDigests, attestation.runtime.imageDigest),
    listAllows(policy.allowedImageDigests, attestation.runtime.imageDigest)
      ? "Runtime image digest is allowed."
      : `Runtime image digest ${attestation.runtime.imageDigest} is not allowed.`
  );
  check(
    checks,
    "runtime_attestation_code_digest",
    listAllows(policy.allowedCodeDigests, attestation.runtime.codeDigest),
    listAllows(policy.allowedCodeDigests, attestation.runtime.codeDigest)
      ? "Runtime code digest is allowed."
      : `Runtime code digest ${attestation.runtime.codeDigest} is not allowed.`
  );
  check(
    checks,
    "runtime_attestation_policy_compiler_digest",
    listAllows(policy.allowedPolicyCompilerDigests, attestation.runtime.policyCompilerDigest),
    listAllows(policy.allowedPolicyCompilerDigests, attestation.runtime.policyCompilerDigest)
      ? "Runtime policy compiler digest is allowed."
      : `Runtime policy compiler digest ${attestation.runtime.policyCompilerDigest} is not allowed.`
  );
  const measurementFailures = measurementPolicyFailures(attestation, policy);
  check(
    checks,
    "runtime_attestation_measurement_policy",
    measurementFailures.length === 0,
    measurementFailures.length === 0
      ? requiredMeasurementEntries(policy).length > 0
        ? "Runtime measurements match all policy pins."
        : "No exact runtime measurement pins were required by policy."
      : `Runtime measurement policy failed: ${measurementFailures.join("; ")}.`
  );
  if (attestation.attestationType === "aws-nitro-enclave") {
    const failures = nitroPcrPolicyFailures(attestation, policy);
    check(
      checks,
      "runtime_attestation_nitro_pcr_policy",
      failures.length === 0,
      failures.length === 0
        ? "Nitro PCR0/PCR1/PCR2 evidence is present, SHA-384 shaped, and pinned by policy."
        : `Nitro attestation requires pinned PCR0/PCR1/PCR2 measurements: ${failures.join("; ")}.`
    );
  }
  if (policy.maxClockSkewMs !== undefined) {
    const delta = Math.abs(Date.now() - Date.parse(attestation.issuedAt));
    check(
      checks,
      "runtime_attestation_clock_skew",
      delta <= policy.maxClockSkewMs,
      delta <= policy.maxClockSkewMs
        ? `Attestation issuedAt is within maxClockSkewMs ${policy.maxClockSkewMs}.`
        : `Attestation issuedAt ${attestation.issuedAt} is outside maxClockSkewMs ${policy.maxClockSkewMs}.`
    );
  }
  const expectedReceiptHash = options.expectedReceiptHash;
  const expectedCheckpointDigest = options.expectedCheckpointDigest;
  const expectedPayloadDigest = options.expectedPayloadDigest;
  check(
    checks,
    "runtime_attestation_receipt_binding",
    !policy.requireBindingToReceipt && expectedReceiptHash === undefined
      ? true
      : Boolean(attestation.binding.receiptHash) && (!expectedReceiptHash || attestation.binding.receiptHash === expectedReceiptHash),
    attestation.binding.receiptHash
      ? expectedReceiptHash && attestation.binding.receiptHash !== expectedReceiptHash
        ? `Receipt binding mismatch. Expected ${expectedReceiptHash}; observed ${attestation.binding.receiptHash}.`
        : "Receipt binding is present and matches when expected."
      : policy.requireBindingToReceipt || expectedReceiptHash
        ? "Receipt binding is required but missing."
        : "Receipt binding was not required."
  );
  check(
    checks,
    "runtime_attestation_checkpoint_binding",
    !policy.requireBindingToCheckpoint && expectedCheckpointDigest === undefined
      ? true
      : Boolean(attestation.binding.checkpointDigest) &&
          (!expectedCheckpointDigest || attestation.binding.checkpointDigest === expectedCheckpointDigest),
    attestation.binding.checkpointDigest
      ? expectedCheckpointDigest && attestation.binding.checkpointDigest !== expectedCheckpointDigest
        ? `Checkpoint binding mismatch. Expected ${expectedCheckpointDigest}; observed ${attestation.binding.checkpointDigest}.`
        : "Checkpoint binding is present and matches when expected."
      : policy.requireBindingToCheckpoint || expectedCheckpointDigest
        ? "Checkpoint binding is required but missing."
        : "Checkpoint binding was not required."
  );
  check(
    checks,
    "runtime_attestation_payload_binding",
    !policy.requireBindingToPayload && expectedPayloadDigest === undefined
      ? true
      : Boolean(attestation.binding.payloadDigest) && (!expectedPayloadDigest || attestation.binding.payloadDigest === expectedPayloadDigest),
    attestation.binding.payloadDigest
      ? expectedPayloadDigest && attestation.binding.payloadDigest !== expectedPayloadDigest
        ? `Payload binding mismatch. Expected ${expectedPayloadDigest}; observed ${attestation.binding.payloadDigest}.`
        : "Payload binding is present and matches when expected."
      : policy.requireBindingToPayload || expectedPayloadDigest
        ? "Payload binding is required but missing."
        : "Payload binding was not required."
  );

  const expectedAlgorithm = expectedAlgorithmForAttestationType(attestation.attestationType);
  const algorithmMatchesType = attestation.signature.algorithm === expectedAlgorithm;
  check(
    checks,
    "runtime_attestation_signature_algorithm_binding",
    algorithmMatchesType,
    algorithmMatchesType
      ? `${attestation.signature.algorithm} is the expected algorithm for ${attestation.attestationType}.`
      : `${attestation.attestationType} requires ${expectedAlgorithm}; observed ${attestation.signature.algorithm}.`
  );

  if (!algorithmMatchesType) {
    check(checks, "runtime_attestation_signature", false, "Runtime attestation signature algorithm is not valid for the attestation type.");
  } else if (attestation.attestationType === "aws-nitro-enclave" || attestation.signature.algorithm === "aws-nitro-attestation") {
    check(
      checks,
      "runtime_attestation_signature",
      false,
      "AWS Nitro Enclave attestation validation requires a supplied production verifier; bundled Nitro validation is not implemented, so evidence fails closed."
    );
  } else if (attestation.attestationType !== "local-dev-attestation" || attestation.signature.algorithm !== "hmac-sha256") {
    check(checks, "runtime_attestation_signature", false, "Only local-dev HMAC attestation verification is implemented.");
  } else if (!options.attestationSecret) {
    check(
      checks,
      "runtime_attestation_signature",
      false,
      "Local-dev attestation verification requires --attestation-secret or GHOST_ARK_LOCAL_ATTESTATION_SECRET."
    );
  } else {
    const expected = localRuntimeAttestationSignature(options.attestationSecret, {
      ...attestation,
      signature: { ...attestation.signature, value: "" }
    });
    const signatureMatches = constantTimeStringEquals(attestation.signature.value, expected);
    check(
      checks,
      "runtime_attestation_signature",
      signatureMatches,
      signatureMatches
        ? "Local-dev HMAC runtime attestation signature verifies."
        : "Local-dev HMAC runtime attestation signature mismatch."
    );
  }

  return { verdict: checks.every((entry) => entry.passed), checks };
}

function receiptProofStatementDigest(statement) {
  return `sha256:${sha256Hex(canonicalize({
    schemaVersion: "ghost.receipt_proof_statement.digest.v1",
    proofSystem: statement.proofSystem,
    publicInputs: statement.publicInputs,
    claims: statement.claims
  }))}`;
}

function localReceiptProofTranscriptDigest(statement, transcriptWitnessDigest) {
  return `sha256:${sha256Hex(canonicalize({
    schemaVersion: "ghost.local_receipt_proof_transcript.v1",
    publicInputs: statement.publicInputs,
    claims: statement.claims,
    transcriptWitnessDigest
  }))}`;
}

function isStrictBase64(value) {
  return Boolean(value && value.length > 0 && value.length % 4 === 0 && base64Pattern.test(value));
}

function backendMetadataWitnessLeakage(metadata) {
  if (!isRecord(metadata)) {
    return [];
  }
  return Object.keys(metadata).filter((key) => devOnlyBackendMetadataKeys.has(key));
}

function validateReceiptProofShape(proof) {
  if (!isRecord(proof)) {
    return { passed: false, detail: "Receipt proof must be an object." };
  }
  const unknown = exactKeys(proof, ["schemaVersion", "proofSystem", "statement", "proof"]);
  if (unknown.length > 0) {
    return { passed: false, detail: `Receipt proof contains unknown fields: ${unknown.join(", ")}.` };
  }
  if (proof.schemaVersion !== "ghost.receipt_proof.v1") {
    return { passed: false, detail: "Receipt proof schemaVersion must be ghost.receipt_proof.v1." };
  }
  if (!["local-transcript", "risc0", "sp1", "halo2", "noir", "circom"].includes(proof.proofSystem)) {
    return { passed: false, detail: `Unsupported proof system ${proof.proofSystem ?? "missing"}.` };
  }
  if (!isRecord(proof.statement) || !isRecord(proof.proof)) {
    return { passed: false, detail: "Receipt proof must contain statement and proof objects." };
  }
  const statement = proof.statement;
  const statementUnknown = exactKeys(statement, ["schemaVersion", "proofSystem", "statementDigest", "publicInputs", "claims"]);
  if (statementUnknown.length > 0) {
    return { passed: false, detail: `Receipt proof statement contains unknown fields: ${statementUnknown.join(", ")}.` };
  }
  if (statement.schemaVersion !== "ghost.receipt_proof_statement.v1") {
    return { passed: false, detail: "Receipt proof statement schemaVersion must be ghost.receipt_proof_statement.v1." };
  }
  if (statement.proofSystem !== proof.proofSystem) {
    return { passed: false, detail: "Receipt proof statement proofSystem must match the proof proofSystem." };
  }
  if (typeof statement.statementDigest !== "string" || !sha256DigestPattern.test(statement.statementDigest)) {
    return { passed: false, detail: "Receipt proof statementDigest must be a sha256 digest." };
  }
  if (!isRecord(statement.publicInputs)) {
    return { passed: false, detail: "Receipt proof publicInputs must be an object." };
  }
  const publicInputUnknown = exactKeys(statement.publicInputs, [
    "tenantIdHash",
    "chainHeadHash",
    "epochId",
    "checkpointDigest",
    "merkleRoot",
    "receiptCount",
    "keyManifestDigest"
  ]);
  if (publicInputUnknown.length > 0) {
    return { passed: false, detail: `Receipt proof publicInputs contains unknown fields: ${publicInputUnknown.join(", ")}.` };
  }
  for (const field of ["tenantIdHash", "chainHeadHash", "checkpointDigest", "merkleRoot", "keyManifestDigest"]) {
    if (typeof statement.publicInputs[field] !== "string" || !sha256DigestPattern.test(statement.publicInputs[field])) {
      return { passed: false, detail: `Receipt proof publicInputs.${field} must be a sha256 digest.` };
    }
  }
  if (typeof statement.publicInputs.epochId !== "string" || statement.publicInputs.epochId.length === 0) {
    return { passed: false, detail: "Receipt proof publicInputs.epochId must be non-empty." };
  }
  if (!Number.isInteger(statement.publicInputs.receiptCount) || statement.publicInputs.receiptCount < 1) {
    return { passed: false, detail: "Receipt proof publicInputs.receiptCount must be a positive integer." };
  }
  const claims = statement.claims;
  if (!isRecord(claims)) {
    return { passed: false, detail: "Receipt proof claims must be an object." };
  }
  const requiredClaims = [
    "receiptSignaturesValid",
    "receiptChainLinksValid",
    "tenantConstantAcrossChain",
    "checkpointIncludesChainHead",
    "keyManifestEpochsValid"
  ];
  const claimUnknown = exactKeys(claims, requiredClaims);
  if (claimUnknown.length > 0 || !requiredClaims.every((claim) => claims[claim] === true)) {
    return { passed: false, detail: "Receipt proof claims must contain only the required true claims." };
  }
  const proofUnknown = exactKeys(proof.proof, ["transcriptDigest", "proofBytesBase64", "backendMetadata"]);
  if (proofUnknown.length > 0) {
    return { passed: false, detail: `Receipt proof payload contains unknown fields: ${proofUnknown.join(", ")}.` };
  }
  if (proof.proof.transcriptDigest !== undefined && (typeof proof.proof.transcriptDigest !== "string" || !sha256DigestPattern.test(proof.proof.transcriptDigest))) {
    return { passed: false, detail: "Receipt proof transcriptDigest must be a sha256 digest when supplied." };
  }
  if (proof.proof.proofBytesBase64 !== undefined && (typeof proof.proof.proofBytesBase64 !== "string" || proof.proof.proofBytesBase64.length === 0)) {
    return { passed: false, detail: "Receipt proof proofBytesBase64 must be a non-empty string when supplied." };
  }
  if (proof.proof.backendMetadata !== undefined && !isRecord(proof.proof.backendMetadata)) {
    return { passed: false, detail: "Receipt proof backendMetadata must be an object when supplied." };
  }
  return { passed: true, detail: "Receipt proof shape is valid." };
}

function verifyReceiptProofCli(proof) {
  const checks = [];
  const shape = validateReceiptProofShape(proof);
  check(checks, "receipt_proof_schema", shape.passed, shape.detail);
  if (!shape.passed) {
    return { verdict: false, checks };
  }
  const expectedStatementDigest = receiptProofStatementDigest(proof.statement);
  check(
    checks,
    "receipt_proof_statement_digest",
    proof.statement.statementDigest === expectedStatementDigest,
    proof.statement.statementDigest === expectedStatementDigest
      ? "Statement digest matches public inputs and claims."
      : `Statement digest mismatch. Expected ${expectedStatementDigest}; observed ${proof.statement.statementDigest}.`
  );
  if (proof.proofSystem === "local-transcript") {
    const transcriptWitnessDigest = proof.proof.backendMetadata?.transcriptWitnessDigest;
    const witnessDigestValid = typeof transcriptWitnessDigest === "string" && sha256DigestPattern.test(transcriptWitnessDigest);
    check(
      checks,
      "receipt_proof_local_witness_digest",
      witnessDigestValid,
      witnessDigestValid
        ? "Local transcript witness digest is present in dev-only backend metadata."
        : "Local transcript witness digest is missing or malformed."
    );
    const expectedTranscriptDigest = witnessDigestValid ? localReceiptProofTranscriptDigest(proof.statement, transcriptWitnessDigest) : undefined;
    check(
      checks,
      "receipt_proof_local_transcript_digest",
      Boolean(expectedTranscriptDigest && proof.proof.transcriptDigest === expectedTranscriptDigest),
      expectedTranscriptDigest && proof.proof.transcriptDigest === expectedTranscriptDigest
        ? "Local transcript digest matches the deterministic dev-only transcript."
        : `Local transcript digest mismatch. Expected ${expectedTranscriptDigest ?? "unavailable"}; observed ${proof.proof.transcriptDigest ?? "missing"}.`
    );
  } else {
    const proofBytesValid = isStrictBase64(proof.proof.proofBytesBase64);
    check(
      checks,
      "receipt_proof_proof_bytes",
      proofBytesValid,
      proofBytesValid
        ? "Proof bytes are present and strict base64 encoded for the reserved proof backend."
        : `Proof system ${proof.proofSystem} requires non-empty strict base64 proof bytes.`
    );
    const leakedMetadataKeys = backendMetadataWitnessLeakage(proof.proof.backendMetadata);
    check(
      checks,
      "receipt_proof_private_witness_sealed",
      leakedMetadataKeys.length === 0,
      leakedMetadataKeys.length === 0
        ? "Reserved proof backend metadata does not expose local witness-only fields."
        : `Reserved proof backend metadata leaks local witness-only fields: ${leakedMetadataKeys.join(", ")}.`
    );
    check(
      checks,
      "receipt_proof_backend",
      false,
      `Proof system ${proof.proofSystem} is a reserved interface; bundled verification is not implemented, so evidence fails closed.`
    );
  }
  return { verdict: checks.every((entry) => entry.passed), checks };
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

function verifierReport(result) {
  return {
    schemaVersion: "ghost.verifier_report.v1",
    generatedAt: new Date().toISOString(),
    verifier: {
      name: "ghost-verify"
    },
    verdict: result.verdict,
    receiptId: result.receiptId,
    tenantSlug: result.tenantSlug,
    checks: result.checks,
    nonClaim
  };
}

function printJsonResult(result) {
  console.log(JSON.stringify(verifierReport(result), null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = args.keyManifest ? readJsonFile(args.keyManifest) : undefined;
  const witnessKeyManifest = args.witnessKeyManifest ? readJsonFile(args.witnessKeyManifest) : undefined;
  const attestationPolicy = args.attestationPolicy ? readJsonFile(args.attestationPolicy) : undefined;
  const attestationSecret = args.attestationSecret ?? process.env.GHOST_ARK_LOCAL_ATTESTATION_SECRET;
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
    const proofShape = validateInclusionProofShape(proof, expectedRoot);
    check(result.checks, "inclusion_proof_schema", proofShape.passed, proofShape.detail);
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
      const receiptTenantMatches = record.tenant_id_hash === proof.leaf?.tenantId;
      check(
        result.checks,
        "inclusion_receipt_tenant",
        receiptTenantMatches,
        receiptTenantMatches
          ? "Decision receipt tenant hash matches the included chain-head leaf."
          : "Decision receipt tenant hash does not match the included chain-head leaf."
      );
    }
    result.verdict = result.verdict && proofShape.passed && inclusionPassed && result.checks.every((entry) => entry.passed);
  }

  if (args.runtimeAttestation) {
    if (!attestationPolicy) {
      throw new Error("--attestation-policy is required with --runtime-attestation");
    }
    const attestationResult = verifyRuntimeAttestationCli(readJsonFile(args.runtimeAttestation), attestationPolicy, {
      attestationSecret
    });
    result = {
      verdict: result.verdict && attestationResult.verdict,
      checks: [...result.checks, ...attestationResult.checks]
    };
  }

  if (args.attestedReceiptBundle) {
    if (!attestationPolicy) {
      throw new Error("--attestation-policy is required with --attested-receipt-bundle");
    }
    const bundle = readJsonFile(args.attestedReceiptBundle);
    const bundleIsValid = isRecord(bundle) && bundle.schemaVersion === "ghost.attested_receipt_bundle.v1" && isRecord(bundle.receipt) && isRecord(bundle.attestation);
    check(
      result.checks,
      "attested_receipt_bundle_schema",
      bundleIsValid,
      bundleIsValid
        ? "Attested receipt bundle contains a receipt and runtime attestation."
        : "Attested receipt bundle must use schemaVersion ghost.attested_receipt_bundle.v1 and contain receipt and attestation objects."
    );
    if (bundleIsValid) {
      const expectedReceiptHash =
        bundle.receipt.schema_version === "ghost.receipt.v1"
          ? signedDecisionReceiptHash(bundle.receipt)
          : `sha256:${sha256Hex(canonicalize(bundle.receipt))}`;
      const attestationResult = verifyRuntimeAttestationCli(bundle.attestation, attestationPolicy, {
        expectedReceiptHash,
        attestationSecret
      });
      result = {
        verdict: result.verdict && attestationResult.verdict,
        checks: [...result.checks, ...attestationResult.checks]
      };
    } else {
      result.verdict = false;
    }
  }

  if (args.attestedCheckpointBundle) {
    if (!attestationPolicy) {
      throw new Error("--attestation-policy is required with --attested-checkpoint-bundle");
    }
    const bundle = readJsonFile(args.attestedCheckpointBundle);
    const bundleIsValid =
      isRecord(bundle) &&
      bundle.schemaVersion === "ghost.attested_checkpoint_bundle.v1" &&
      isRecord(bundle.checkpoint) &&
      isRecord(bundle.attestation);
    check(
      result.checks,
      "attested_checkpoint_bundle_schema",
      bundleIsValid,
      bundleIsValid
        ? "Attested checkpoint bundle contains a checkpoint and runtime attestation."
        : "Attested checkpoint bundle must use schemaVersion ghost.attested_checkpoint_bundle.v1 and contain checkpoint and attestation objects."
    );
    if (bundleIsValid) {
      const expectedCheckpointDigest = `sha256:${sha256Hex(canonicalize({
        schemaVersion: "ghost.attested_checkpoint_bundle.checkpoint_digest.v1",
        checkpoint: bundle.checkpoint
      }))}`;
      const attestationResult = verifyRuntimeAttestationCli(bundle.attestation, attestationPolicy, {
        expectedCheckpointDigest,
        attestationSecret
      });
      result = {
        verdict: result.verdict && attestationResult.verdict,
        checks: [...result.checks, ...attestationResult.checks]
      };
    } else {
      result.verdict = false;
    }
  }

  if (args.witnessCheckpointConsistencyProof) {
    if (!args.previousWitnessCheckpoint || !args.newWitnessCheckpoint) {
      throw new Error("--previous-witness-checkpoint and --new-witness-checkpoint are required with --witness-checkpoint-consistency-proof");
    }
    const consistencyResult = verifyResearchWitnessCheckpointConsistency(
      readJsonFile(args.previousWitnessCheckpoint),
      readJsonFile(args.newWitnessCheckpoint),
      readJsonFile(args.witnessCheckpointConsistencyProof),
      witnessKeyManifest
    );
    result = {
      verdict: result.verdict && consistencyResult.verdict,
      checks: [...result.checks, ...consistencyResult.checks]
    };
  }

  if (args.receiptProof) {
    const proofResult = verifyReceiptProofCli(readJsonFile(args.receiptProof));
    result = {
      verdict: result.verdict && proofResult.verdict,
      checks: [...result.checks, ...proofResult.checks]
    };
  }

  if (args.json) {
    printJsonResult(result);
  } else {
    printResult(result);
  }
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
