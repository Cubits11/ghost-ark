/**
 * E4-B fixture generator — compromised-signer receipts.
 *
 * The gap this closes
 * -------------------
 * E4 found that 5 of the verifier's 10 named checks flip ZERO corpus attacks when neutered.
 * The reason is a threat-model gap, not redundancy: every existing fixture that mutates a
 * signed field also invalidates the digest and the signature, because the signature was
 * computed over the ORIGINAL payload. The verifier short-circuits at `signature` and the
 * earlier checks are never the thing that caught it, so neutering them changes nothing.
 *
 * Isolating those checks requires an adversary who can produce a VALID signature over a
 * MUTATED payload — i.e. one who holds the signing key. The corpus never modelled that.
 *
 * Why this is feasible here without a real credential
 * --------------------------------------------------
 * The HMAC path uses a PUBLISHED DEV-ONLY TEST VECTOR, recorded in
 * examples/reproducibility/manifest.json. It is not a credential and never was: local HMAC
 * signing is dev-only and is never a production signing mode. Holding it lets this generator
 * play the compromised signer for the dev path exactly, with no secret involved.
 *
 * The RSA/KMS path is NOT covered. This repository holds only the public key, so a valid
 * RSA-PSS signature over a mutated payload cannot be produced here. That asymmetry is a
 * genuine limit and is recorded rather than worked around.
 *
 * The lever
 * ---------
 * The verifier computes:
 *
 *   unsigned          = receipt minus receipt_signature
 *   withoutId         = unsigned minus receipt_id
 *   canonicalPayload  = canonicalize(unsigned)          <- signature and envelope digest cover THIS
 *   receipt_id        = "grct_" + sha256(canonicalize(withoutId))
 *
 * `receipt_id` is INSIDE the signed payload but is itself derived from the payload WITHOUT it.
 * So a signer can sign a payload that contains a wrong `receipt_id`: the digest and signature
 * checks pass over exactly the bytes presented, while the `receipt_id` check independently
 * recomputes and fails. That is the isolation E4 could not previously achieve.
 *
 * NON-CLAIM: these fixtures demonstrate that specific verifier checks are independently
 * load-bearing under a compromised-signer adversary on the dev HMAC path. They are not
 * evidence about the KMS path, not evidence of cryptographic strength, and not evidence of
 * model safety, semantic truth, compliance, or AWS behavior. A receipt that passes every
 * check is not thereby true.
 */

import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalize, sha256Hex } from "../../packages/receipt-schema/src/hashCanonicalization";

const REPO_ROOT = resolve(__dirname, "../..");
const CORPUS_DIR = resolve(REPO_ROOT, "examples/malicious-receipts");
const REPRO_DIR = resolve(REPO_ROOT, "examples/reproducibility");

/** Published dev-only test vector. NOT a credential; local HMAC signing is dev-only. */
const HMAC_TEST_VECTOR = "ghost-ark-repro-signing-dev-only-test-vector-v1";
const HMAC_KEY_ID = "local-dev-hmac";
/**
 * Published dev-only IDENTITY test vector, distinct from the signing vector. Also not a
 * credential. Used so MAL-028 carries a GENUINE tenant commitment for a different tenant
 * rather than an arbitrary hex string, which the schema would reject and which would test
 * schema validation instead of the tenant boundary.
 */
const IDENTITY_TEST_VECTOR = "ghost-ark-repro-identity-dev-only-test-vector-v1";
const SUBSTITUTED_TENANT = "tenant-repro-b";
const HMAC_ALGORITHM = "LOCAL_HMAC_SHA256_DEV_ONLY";
const ENVELOPE_SCHEMA_VERSION = "ghost.decision_receipt_signature.v1";

type Receipt = Record<string, unknown>;

/**
 * Re-sign a receipt so its envelope and signature are VALID over whatever payload it
 * currently carries. This is the compromised signer.
 *
 * `recomputeReceiptId` controls the isolation target:
 *   true  -> receipt_id is made consistent, so the receipt_id check PASSES and some other
 *            check (or a consumer expectation) must be the thing that rejects it.
 *   false -> receipt_id is left as-is, so the receipt_id check FAILS while digest and
 *            signature both PASS. This is what isolates receipt_id.
 */
function signAsCompromisedSigner(receipt: Receipt, recomputeReceiptId: boolean): Receipt {
  const working: Receipt = { ...receipt };
  delete working.receipt_signature;

  if (recomputeReceiptId) {
    const { receipt_id: _drop, ...withoutId } = working;
    working.receipt_id = `grct_${sha256Hex(canonicalize(withoutId))}`;
  }

  // Field order matters: the verifier re-canonicalizes and compares, so the envelope must be
  // emitted in canonical field order. canonicalize() sorts, so building it as an object and
  // canonicalizing is sufficient.
  const canonicalPayload = canonicalize(working);
  const digestSha256 = sha256Hex(canonicalPayload);
  const signature = createHmac("sha256", HMAC_TEST_VECTOR).update(canonicalPayload).digest("base64");

  const envelope = {
    algorithm: HMAC_ALGORITHM,
    digestSha256,
    keyId: HMAC_KEY_ID,
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    signature
  };

  return {
    ...working,
    receipt_signature: Buffer.from(canonicalize(envelope), "utf8").toString("base64url")
  };
}

export interface CompromisedFixtureSpec {
  attackId: string;
  attackName: string;
  isolationTarget: string;
  mutatedField: string;
  mutationDescription: string;
  claimBoundary: string;
  expectedRejectionPhase: string;
  /** Mutate the receipt body. Return the mutated receipt. */
  mutate: (receipt: Receipt) => Receipt;
  /** Whether to make receipt_id consistent after mutation. */
  recomputeReceiptId: boolean;
  /** Consumer expectation needed to reject, when no verifier rule can. */
  expectedTenantId?: string;
}

export const COMPROMISED_FIXTURES: readonly CompromisedFixtureSpec[] = [
  {
    attackId: "MAL-027",
    attackName: "signed-receipt-id-inconsistency",
    isolationTarget: "receipt_id",
    mutatedField: "receipt_id",
    mutationDescription:
      "A compromised signer flips the final hex character of receipt_id and then re-signs the payload CONTAINING the " +
      "wrong id using the published dev-only HMAC test vector. The envelope digest and the signature are both valid " +
      "over exactly the bytes presented, so only the independent receipt_id recomputation can reject this receipt.",
    claimBoundary:
      "Isolates the receipt_id check. Under an adversary holding the signing key, digest and signature validity say " +
      "nothing about receipt identity: receipt_id is derived from the payload WITHOUT receipt_id, so a signer can sign " +
      "an inconsistent id. Only the recomputation catches it.",
    expectedRejectionPhase: "receipt_id",
    recomputeReceiptId: false,
    mutate: (receipt) => {
      const current = receipt.receipt_id as string;
      const lastCharacter = current.slice(-1);
      const replacement = lastCharacter === "0" ? "1" : "0";
      return { ...receipt, receipt_id: `${current.slice(0, -1)}${replacement}` };
    }
  },
  {
    attackId: "MAL-028",
    attackName: "signed-cross-tenant-substitution",
    isolationTarget: "tenant_expectation",
    mutatedField: "tenant_id_hash",
    mutationDescription:
      "A compromised signer replaces tenant_id_hash with a different tenant's commitment, recomputes receipt_id, and " +
      "re-signs. Every verifier rule passes: the receipt is internally consistent and validly signed. Only a consumer " +
      "supplying its own expected tenant can reject it.",
    claimBoundary:
      "Isolates the tenant_expectation check and is the Provenance Kernel Problem under a key-holding adversary: the " +
      "receipt is CORRECT by every intrinsic rule, and soundness depends entirely on the consumer set. A verifier " +
      "without a declared tenant expectation cannot reject this receipt and must not be asked to.",
    expectedRejectionPhase: "tenant_expectation",
    recomputeReceiptId: true,
    expectedTenantId: SUBSTITUTED_TENANT,
    mutate: (receipt) => ({
      ...receipt,
      // A real HMAC commitment for a different tenant, computed the same way the verifier
      // computes the expected value. An arbitrary hex string would fail schema validation and
      // would therefore test the schema check rather than the tenant boundary.
      tenant_id_hash: `hmac-sha256:${createHmac("sha256", IDENTITY_TEST_VECTOR).update(SUBSTITUTED_TENANT).digest("hex")}`
    })
  },
  {
    attackId: "MAL-029",
    attackName: "signed-timestamp-backdating",
    isolationTarget: "consumer freshness policy",
    mutatedField: "timestamp",
    mutationDescription:
      "A compromised signer backdates the receipt timestamp by one year, recomputes receipt_id, and re-signs. Every " +
      "verifier rule passes, because the verifier implements no freshness policy.",
    claimBoundary:
      "Documents a boundary rather than a defect: this verifier does NOT check freshness, and a validly-signed " +
      "backdated receipt is indistinguishable from a genuine one under its rules. Rejecting this requires a consumer " +
      "freshness policy that this repository does not implement. Recorded so the absence is explicit rather than " +
      "discovered.",
    expectedRejectionPhase: "none_implemented",
    recomputeReceiptId: true,
    mutate: (receipt) => {
      const original = receipt.timestamp as string;
      const backdated = new Date(Date.parse(original) - 365 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/u, ".000Z");
      return { ...receipt, timestamp: backdated };
    }
  },
  {
    attackId: "MAL-030",
    attackName: "signed-decision-escalation",
    isolationTarget: "consumer policy review",
    mutatedField: "decision_post",
    mutationDescription:
      "A compromised signer rewrites decision_post from its original value to ALLOW, recomputes receipt_id, and " +
      "re-signs. Every verifier rule passes.",
    claimBoundary:
      "The sharpest statement of what a receipt is NOT. Signing proves signing authorization over the payload; it does " +
      "not make the payload true. Under a compromised signer, a receipt can attest that a REFUSE decision was an ALLOW " +
      "and remain cryptographically flawless. No verifier rule can detect this, and none should be claimed to.",
    expectedRejectionPhase: "none_implemented",
    recomputeReceiptId: true,
    mutate: (receipt) => ({ ...receipt, decision_post: "ALLOW", action_taken: ["allow"] })
  }
] as const;

export interface GeneratedFixture {
  spec: CompromisedFixtureSpec;
  path: string;
  relativePath: string;
  receipt: Receipt;
}

export function generateCompromisedFixtures(baseFixtureId = "hmac-baseline"): GeneratedFixture[] {
  const basePath = resolve(REPRO_DIR, "receipts", `${baseFixtureId}.receipt.json`);
  const base = JSON.parse(readFileSync(basePath, "utf8")) as Receipt;

  return COMPROMISED_FIXTURES.map((spec) => {
    const mutated = spec.mutate({ ...base });
    const signed = signAsCompromisedSigner(mutated, spec.recomputeReceiptId);
    const relativePath = `receipts/${spec.attackId}.${spec.attackName}.receipt.json`;
    return {
      spec,
      path: resolve(CORPUS_DIR, relativePath),
      relativePath,
      receipt: signed
    };
  });
}

function main(): void {
  const write = process.argv.includes("--write");
  const generated = generateCompromisedFixtures();

  for (const fixture of generated) {
    const serialized = `${JSON.stringify(fixture.receipt, null, 2)}\n`;
    if (write) {
      writeFileSync(fixture.path, serialized, "utf8");
    }
    process.stdout.write(`${write ? "wrote" : "would write"} ${fixture.relativePath}  (isolates: ${fixture.spec.isolationTarget})\n`);
  }

  if (!write) {
    process.stdout.write("\nRe-run with --write to emit the fixtures.\n");
  }
}

if (require.main === module) {
  main();
}
