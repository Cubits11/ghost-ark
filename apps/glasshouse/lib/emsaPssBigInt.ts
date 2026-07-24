/**
 * Pure-BigInt RSA-PSS / EMSA-PSS-VERIFY over a PRE-COMPUTED digest (RFC 8017,
 * PKCS #1 v2.2 §9.1.2 + §8.1.2). This exists for exactly one reason: to verify
 * AWS KMS `MessageType: DIGEST` signatures in the browser.
 *
 * THE DOUBLE-HASH WALL. `crypto.subtle.verify(RSA-PSS, key, sig, M)` internally
 * computes SHA-256(M) before the RSA primitive. KMS DIGEST mode signs the
 * digest `d` DIRECTLY (RSA-PSS over d, no second hash). Handing subtle the
 * 32-byte `d` makes it verify against SHA-256(d) ≠ d → always fails. There is
 * no message whose SHA-256 equals a given d, so subtle cannot be coaxed into
 * it. This module does the RSA math itself (modular exponentiation + EMSA-PSS
 * decode) with `mHash = d` — no double hash.
 *
 * NOT constant-time in the modexp (JS BigInt is variable-time), but this is a
 * PUBLIC-KEY verification of PUBLIC data: there is no secret to leak. The only
 * comparison of derived material (H' vs H) is constant-time out of habit.
 *
 * CORRECTNESS BOUNDARY. Validated in tests/differential/emsaPssBigIntAgreement
 * against (a) the real `kms-digest-mode` reproducibility fixture, (b) fresh
 * OpenSSL RSA-PSS-over-digest signatures, and (c) tamper/corruption rejection.
 * A PASS proves the signature verifies under this public key — nothing about
 * KMS custody, model behavior, or truth.
 */

export interface RsaPublicKey {
  n: bigint;
  e: bigint;
  /** Bit length of the modulus n (e.g. 2048, 4096). */
  bitLength: number;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** MGF1 with SHA-256 (RFC 8017 Appendix B.2.1). */
async function mgf1Sha256(seed: Uint8Array, maskLen: number): Promise<Uint8Array> {
  const mask = new Uint8Array(maskLen);
  let offset = 0;
  for (let counter = 0; offset < maskLen; counter += 1) {
    const c = new Uint8Array(seed.length + 4);
    c.set(seed, 0);
    c[seed.length] = (counter >>> 24) & 0xff;
    c[seed.length + 1] = (counter >>> 16) & 0xff;
    c[seed.length + 2] = (counter >>> 8) & 0xff;
    c[seed.length + 3] = counter & 0xff;
    const block = await sha256(c);
    const n = Math.min(block.length, maskLen - offset);
    mask.set(block.subarray(0, n), offset);
    offset += n;
  }
  return mask;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** m = base^exp mod modulus (square-and-multiply). */
function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  base %= modulus;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % modulus;
    exp >>= 1n;
    base = (base * base) % modulus;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function i2osp(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new RangeError("integer too large for the requested length");
  return out;
}

/**
 * RSASSA-PSS verification of `signature` over the pre-computed `mHash`
 * (digest-as-mhash). Never throws — returns false on any structural failure.
 * `sLen` is the salt length; KMS RSASSA_PSS_SHA_256 uses 32 (= hLen).
 */
export async function verifyRsaPssDigestAsMhash(
  mHash: Uint8Array,
  signature: Uint8Array,
  publicKey: RsaPublicKey,
  sLen = 32,
): Promise<boolean> {
  try {
    const hLen = 32;
    const modBits = publicKey.bitLength;
    const k = Math.ceil(modBits / 8);
    if (mHash.length !== hLen) return false;
    if (signature.length !== k) return false;

    // RFC 8017 §8.1.2: s must be in [0, n-1]; m = s^e mod n.
    const s = bytesToBigInt(signature);
    if (s >= publicKey.n) return false;
    const m = modPow(s, publicKey.e, publicKey.n);

    // EMSA-PSS-VERIFY (§9.1.2). emBits = modBits - 1.
    const emBits = modBits - 1;
    const emLen = Math.ceil(emBits / 8);
    let EM: Uint8Array;
    try {
      EM = i2osp(m, emLen);
    } catch {
      return false; // m does not fit emLen → inconsistent
    }
    if (EM[emLen - 1] !== 0xbc) return false;

    const dbLen = emLen - hLen - 1;
    if (dbLen <= 0) return false;
    const maskedDB = EM.subarray(0, dbLen);
    const H = EM.subarray(dbLen, dbLen + hLen);

    // The leftmost (8*emLen - emBits) bits of maskedDB[0] must be zero.
    const maskBits = 8 * emLen - emBits; // = 1 for a multiple-of-8 modulus
    const topMask = 0xff >>> maskBits; // low bits kept
    if ((maskedDB[0] & ~topMask & 0xff) !== 0) return false;

    const dbMask = await mgf1Sha256(H, dbLen);
    const DB = new Uint8Array(dbLen);
    for (let i = 0; i < dbLen; i += 1) DB[i] = maskedDB[i] ^ dbMask[i];
    DB[0] &= topMask;

    // DB = PS(0x00…) || 0x01 || salt, with |PS| = emLen - sLen - hLen - 2.
    const psLen = emLen - sLen - hLen - 2;
    if (psLen < 0) return false;
    for (let i = 0; i < psLen; i += 1) if (DB[i] !== 0x00) return false;
    if (DB[psLen] !== 0x01) return false;
    const salt = DB.subarray(dbLen - sLen);

    // M' = (0x00)*8 || mHash || salt ; H' = SHA-256(M') ; assert H' == H.
    const mPrime = new Uint8Array(8 + hLen + sLen);
    mPrime.set(mHash, 8);
    mPrime.set(salt, 8 + hLen);
    const HPrime = await sha256(mPrime);
    return constantTimeEqual(H, HPrime);
  } catch {
    return false;
  }
}

/**
 * Extracts { n, e, bitLength } from an SPKI PEM using the platform's own JWK
 * export (no hand-rolled DER parsing). Works in the browser and Node ≥ 18.
 */
export async function rsaPublicKeyFromPem(pem: string): Promise<RsaPublicKey> {
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey(
    "spki",
    der as BufferSource,
    { name: "RSA-PSS", hash: "SHA-256" },
    true,
    ["verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.n || !jwk.e) throw new Error("public key JWK missing modulus/exponent");
  const nBytes = base64UrlToBytes(jwk.n);
  const n = bytesToBigInt(nBytes);
  const e = bytesToBigInt(base64UrlToBytes(jwk.e));
  return { n, e, bitLength: n.toString(2).length };
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/u, "").replace(/-----END [^-]+-----/u, "").replace(/\s+/gu, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/gu, "+").replace(/_/gu, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
