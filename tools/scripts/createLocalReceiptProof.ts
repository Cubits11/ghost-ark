#!/usr/bin/env ts-node
import fs from "fs";
import path from "path";
import { canonicalSha256Hex } from "../../packages/receipt-schema/src/hashCanonicalization";
import { signedDecisionReceiptHash } from "../../packages/enforcement-runtime/src/receipts/canonical";
import { SignedDecisionReceipt, validateSignedDecisionReceipt } from "../../packages/enforcement-runtime/src/receipts/schema";
import { createLocalReceiptProof } from "../../packages/enforcement-runtime/src/proofs/localReceiptProof";
import { ReceiptProofClaims, ReceiptProofPublicInputs } from "../../packages/enforcement-runtime/src/proofs/receiptProof";

interface Args {
  chain?: string;
  checkpoint?: string;
  inclusionProof?: string;
  keyManifest?: string;
  out?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--chain") {
      args.chain = next;
      index += 1;
    } else if (arg === "--checkpoint") {
      args.checkpoint = next;
      index += 1;
    } else if (arg === "--inclusion-proof") {
      args.inclusionProof = next;
      index += 1;
    } else if (arg === "--key-manifest") {
      args.keyManifest = next;
      index += 1;
    } else if (arg === "--out") {
      args.out = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage(): void {
  console.log(`Ghost Ark local receipt proof creator

Usage:
  npm run receipt-proof:local -- --chain chain.json --checkpoint checkpoint.json --inclusion-proof inclusion.json --key-manifest key-manifest.json --out receipt-proof.json

The local transcript backend is deterministic and dev-only. It is not a zero-knowledge proof system.
`);
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateChain(value: unknown): SignedDecisionReceipt[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Chain must contain at least one signed decision receipt.");
  }
  return value.map((receipt) => validateSignedDecisionReceipt(receipt));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const chain = validateChain(readJson(required(args.chain, "--chain")));
  const checkpoint = readJson(required(args.checkpoint, "--checkpoint")) as { epochId: string; merkleRoot: string };
  const inclusionProof = readJson(required(args.inclusionProof, "--inclusion-proof"));
  const keyManifest = readJson(required(args.keyManifest, "--key-manifest"));
  const outPath = required(args.out, "--out");
  const head = chain[chain.length - 1];

  const publicInputs: ReceiptProofPublicInputs = {
    tenantIdHash: `sha256:${canonicalSha256Hex({
      schemaVersion: "ghost.receipt_proof.tenant_id_public_hash.v1",
      tenantIdHash: head.tenant_id_hash
    })}`,
    chainHeadHash: signedDecisionReceiptHash(head),
    epochId: checkpoint.epochId,
    checkpointDigest: `sha256:${canonicalSha256Hex({
      schemaVersion: "ghost.receipt_proof.checkpoint_digest.v1",
      checkpoint
    })}`,
    merkleRoot: checkpoint.merkleRoot,
    receiptCount: chain.length,
    keyManifestDigest: `sha256:${canonicalSha256Hex({
      schemaVersion: "ghost.receipt_proof.key_manifest_digest.v1",
      keyManifest
    })}`
  };
  const claims: ReceiptProofClaims = {
    receiptSignaturesValid: true,
    receiptChainLinksValid: true,
    tenantConstantAcrossChain: true,
    checkpointIncludesChainHead: true,
    keyManifestEpochsValid: true
  };
  const proof = createLocalReceiptProof({
    publicInputs,
    claims,
    transcriptWitnessDigest: `sha256:${canonicalSha256Hex({
      schemaVersion: "ghost.local_receipt_proof.private_witness_digest.v1",
      receipts: chain,
      checkpoint,
      inclusionProof,
      keyManifest
    })}`
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(proof, null, 2));
  console.log(`Wrote local transcript receipt proof to ${outPath}`);
  console.log("Non-claim: the local transcript backend is not a zero-knowledge proof system.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
