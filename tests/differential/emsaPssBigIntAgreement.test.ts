/**
 * Correctness proof for the pure-BigInt RSA-PSS engine that verifies KMS
 * DIGEST-mode (digest-as-mhash) signatures the Web Crypto API cannot.
 *
 * Three independent references, because a hand-rolled crypto primitive is only
 * trustworthy if it agrees with things that were not written for this repo:
 *   1. the REAL `kms-digest-mode` reproducibility fixture (a genuine signature);
 *   2. fresh OpenSSL RSA-PSS-over-digest signatures at 2048 and 3072 bits;
 *   3. tamper/corruption rejection (flipped signature, digest, salt length).
 *
 * If any of these fails, the engine must not be shipped — a wrong "PROVED" is
 * worse than an honest "UNVERIFIABLE".
 */

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { canonicalize, sha256Hex, hexToBytes, base64ToBytes } from "../../apps/glasshouse/lib/webReceiptVerifier";
import { verifyRsaPssDigestAsMhash, rsaPublicKeyFromPem } from "../../apps/glasshouse/lib/emsaPssBigInt";

const R = (p: string) => resolve(process.cwd(), p);
const fixture = JSON.parse(readFileSync(R("examples/reproducibility/pss-digest-mode/kms-digest-mode.receipt.json"), "utf-8"));
const keyPem = readFileSync(R("examples/reproducibility/pss-digest-mode/public-key.pem"), "utf-8");

function opensslAvailable(): boolean {
  try { execFileSync("openssl", ["version"], { stdio: "pipe" }); return true; } catch { return false; }
}

describe("BigInt EMSA-PSS — the real fixture", () => {
  it("verifies the genuine kms-digest-mode signature (what subtle cannot)", async () => {
    const { receipt_signature, ...unsigned } = fixture;
    const env = JSON.parse(new TextDecoder().decode(base64ToBytes(receipt_signature)));
    const digestHex = await sha256Hex(canonicalize(unsigned));
    expect(digestHex, "recomputed digest must match the envelope").toBe(env.digestSha256);
    const pk = await rsaPublicKeyFromPem(keyPem);
    expect(pk.bitLength).toBe(2048);
    expect(pk.e).toBe(65537n);
    const ok = await verifyRsaPssDigestAsMhash(hexToBytes(digestHex), base64ToBytes(env.signature), pk);
    expect(ok).toBe(true);
  });

  it("rejects a flipped signature byte", async () => {
    const { receipt_signature, ...unsigned } = fixture;
    const env = JSON.parse(new TextDecoder().decode(base64ToBytes(receipt_signature)));
    const pk = await rsaPublicKeyFromPem(keyPem);
    const mHash = hexToBytes(await sha256Hex(canonicalize(unsigned)));
    const sig = base64ToBytes(env.signature);
    const bad = Uint8Array.from(sig); bad[100] ^= 0x01;
    expect(await verifyRsaPssDigestAsMhash(mHash, bad, pk)).toBe(false);
  });

  it("rejects a flipped digest bit", async () => {
    const { receipt_signature, ...unsigned } = fixture;
    const env = JSON.parse(new TextDecoder().decode(base64ToBytes(receipt_signature)));
    const pk = await rsaPublicKeyFromPem(keyPem);
    const mHash = hexToBytes(await sha256Hex(canonicalize(unsigned)));
    const badH = Uint8Array.from(mHash); badH[0] ^= 0x01;
    expect(await verifyRsaPssDigestAsMhash(badH, base64ToBytes(env.signature), pk)).toBe(false);
  });

  it("rejects the correct signature under the wrong salt length", async () => {
    const { receipt_signature, ...unsigned } = fixture;
    const env = JSON.parse(new TextDecoder().decode(base64ToBytes(receipt_signature)));
    const pk = await rsaPublicKeyFromPem(keyPem);
    const mHash = hexToBytes(await sha256Hex(canonicalize(unsigned)));
    expect(await verifyRsaPssDigestAsMhash(mHash, base64ToBytes(env.signature), pk, 16)).toBe(false);
  });
});

describe.skipIf(!opensslAvailable())("BigInt EMSA-PSS — OpenSSL differential", () => {
  for (const bits of [2048, 3072]) {
    it(`agrees with OpenSSL RSA-PSS-over-digest at ${bits} bits`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "emsa-"));
      const priv = join(dir, "priv.pem");
      const pub = join(dir, "pub.pem");
      const dBin = join(dir, "d.bin");
      const sigBin = join(dir, "sig.bin");
      execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", `rsa_keygen_bits:${bits}`, "-out", priv], { stdio: "pipe" });
      execFileSync("openssl", ["rsa", "-pubout", "-in", priv, "-out", pub], { stdio: "pipe" });
      // A real 32-byte SHA-256 digest of some payload — this is the "mHash" KMS would receive.
      const digest = hexToBytes(await sha256Hex("grct_canonical_test_payload"));
      writeFileSync(dBin, digest);
      // Sign the raw digest directly (pkeyutl -sign does NOT re-hash): KMS DIGEST mode.
      execFileSync("openssl", ["pkeyutl", "-sign", "-inkey", priv, "-in", dBin,
        "-pkeyopt", "rsa_padding_mode:pss", "-pkeyopt", "digest:sha256", "-pkeyopt", "rsa_pss_saltlen:32", "-out", sigBin], { stdio: "pipe" });
      const sig = new Uint8Array(readFileSync(sigBin));
      const pk = await rsaPublicKeyFromPem(readFileSync(pub, "utf-8"));
      expect(pk.bitLength).toBe(bits);
      expect(await verifyRsaPssDigestAsMhash(digest, sig, pk)).toBe(true);
      // A different digest must not verify against the same signature.
      const other = hexToBytes(await sha256Hex("different_payload"));
      expect(await verifyRsaPssDigestAsMhash(other, sig, pk)).toBe(false);
    });
  }
});
