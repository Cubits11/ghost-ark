import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findManifestEntryForKey,
  keyManifestSchemaVersion,
  readKeyManifestFile,
  validateKeyManifest,
  verifyKeyManifestEpoch,
  verifyKeyManifestSigningAuthorization,
  type KeyManifest,
  type KeyManifestEntry
} from "../../../../packages/enforcement-runtime/src/receipts/keyManifest";

/**
 * Branch tests for the key manifest, written against experiment E10's report.
 *
 * `keyManifest.ts` scored 61.0% covered (94/154) with **33 of its 187 mutants
 * executed by no test at all**. What was unreached is the epoch arithmetic —
 * every comparison that decides whether a key was allowed to sign at the moment
 * a receipt claims it did.
 *
 * This module encodes a distinction the rest of the kernel depends on:
 * **verification and signing have different rules.** A historical receipt stays
 * verifiable after its key is deprecated or revoked, because revoking a key
 * cannot retroactively unmake the evidence it produced. But only an ACTIVE key
 * may create a NEW signature. Collapsing those two rules in either direction is
 * a real failure — one destroys the audit trail, the other lets a revoked key
 * keep signing — and the code separating them was largely untested.
 */

const KEY = "arn:aws:kms:us-east-1:111122223333:key/00000000-0000-0000-0000-00000000000a";
const ALG = "KMS_SIGN_RSASSA_PSS_SHA_256";

function entry(overrides: Partial<KeyManifestEntry> = {}): KeyManifestEntry {
  return {
    keyId: KEY,
    algorithm: ALG,
    validFrom: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    ...overrides
  } as KeyManifestEntry;
}

function manifest(entries: KeyManifestEntry[] = [entry()]): KeyManifest {
  return {
    schemaVersion: keyManifestSchemaVersion,
    generatedAt: "2026-01-01T00:00:00.000Z",
    keys: entries
  } as KeyManifest;
}

const epoch = (over: Partial<Parameters<typeof verifyKeyManifestEpoch>[0]> = {}) =>
  verifyKeyManifestEpoch({ manifest: manifest(), keyId: KEY, algorithm: ALG, timestamp: "2026-06-01T00:00:00.000Z", ...over });

describe("key manifest: schema invariants", () => {
  it("accepts a well-formed manifest", () => {
    // The control arm.
    expect(() => validateKeyManifest(manifest())).not.toThrow();
    expect(epoch().passed).toBe(true);
  });

  it("rejects a duplicate keyId+algorithm pair", () => {
    // Two entries for one identity make "which rule applies" ambiguous, and the
    // lookup would silently pick whichever came first.
    expect(() => validateKeyManifest(manifest([entry(), entry()]))).toThrow(/Duplicate key manifest entry/u);
  });

  it("allows the same keyId under a different algorithm", () => {
    // The other side of the uniqueness rule: identity is the PAIR. A mutant
    // keying the set on keyId alone would reject this legitimate manifest.
    expect(() =>
      validateKeyManifest(manifest([entry(), entry({ algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY" })]))
    ).not.toThrow();
  });

  it("rejects validUntil at or before validFrom", () => {
    // `<=`, not `<`: a key valid for zero duration is a configuration error, not
    // a key. Both boundary cases are asserted so the comparison cannot weaken.
    expect(() => validateKeyManifest(manifest([entry({ validUntil: "2025-01-01T00:00:00.000Z" })]))).toThrow(
      /validUntil must be later than validFrom/u
    );
    expect(() => validateKeyManifest(manifest([entry({ validUntil: "2026-01-01T00:00:00.000Z" })]))).toThrow(
      /validUntil must be later than validFrom/u
    );
    expect(() =>
      validateKeyManifest(manifest([entry({ validUntil: "2026-01-01T00:00:00.001Z" })]))
    ).not.toThrow();
  });

  it("rejects revokedAt earlier than validFrom but allows it equal", () => {
    // `<`, not `<=`: a key revoked at the instant it became valid is degenerate
    // but coherent — it signed nothing. Revoked BEFORE it existed is incoherent.
    expect(() => validateKeyManifest(manifest([entry({ revokedAt: "2025-12-31T23:59:59.999Z" })]))).toThrow(
      /revokedAt cannot be earlier than validFrom/u
    );
    expect(() => validateKeyManifest(manifest([entry({ revokedAt: "2026-01-01T00:00:00.000Z" })]))).not.toThrow();
  });

  it("rejects an unknown field rather than ignoring it", () => {
    // `.strict()`. An ignored field is a field someone believed was enforced.
    expect(() => validateKeyManifest({ ...manifest(), extra: "smuggled" })).toThrow();
    expect(() => validateKeyManifest(manifest([{ ...entry(), extra: "smuggled" } as never]))).toThrow();
  });

  it("requires at least one key", () => {
    expect(() => validateKeyManifest(manifest([]))).toThrow();
  });

  it("reads a manifest from disk", () => {
    // Kills readKeyManifestFile, which no test executed.
    const dir = mkdtempSync(join(tmpdir(), "ghost-ark-manifest-"));
    const file = join(dir, "manifest.json");
    writeFileSync(file, JSON.stringify(manifest()));
    expect(readKeyManifestFile(file).keys[0]?.keyId).toBe(KEY);

    writeFileSync(file, JSON.stringify({ schemaVersion: "wrong" }));
    expect(() => readKeyManifestFile(file)).toThrow();
  });
});

describe("key manifest: entry lookup", () => {
  it("prefers the exact keyId+algorithm match", () => {
    const found = findManifestEntryForKey(
      manifest([entry({ algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY" }), entry()]),
      KEY,
      ALG
    );
    expect(found?.algorithm).toBe(ALG);
  });

  it("returns null when the key is absent", () => {
    expect(findManifestEntryForKey(manifest(), "unknown-key", ALG)).toBeNull();
  });
});

describe("key manifest: verification epoch arithmetic", () => {
  it("fails a receipt timestamped before validFrom", () => {
    // A receipt claiming a key that did not yet exist is not evidence about that
    // key. Its mutants were unreached entirely.
    const check = epoch({ timestamp: "2025-12-31T23:59:59.999Z" });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/before key validFrom/u);
  });

  it("accepts a receipt exactly at validFrom", () => {
    // The inclusive boundary. Without it, a mutant turning `<` into `<=` would
    // survive and reject the first receipt a key ever signed.
    expect(epoch({ timestamp: "2026-01-01T00:00:00.000Z" }).passed).toBe(true);
  });

  it("fails a receipt at or after validUntil, and accepts just before", () => {
    // `>=`, exclusive upper bound. Both sides asserted so the comparison cannot
    // shift by one millisecond undetected.
    const withUntil = manifest([entry({ validUntil: "2026-06-01T00:00:00.000Z" })]);
    expect(epoch({ manifest: withUntil, timestamp: "2026-06-01T00:00:00.000Z" }).passed).toBe(false);
    expect(epoch({ manifest: withUntil, timestamp: "2026-06-01T00:00:00.000Z" }).detail).toMatch(/not before key validUntil/u);
    expect(epoch({ manifest: withUntil, timestamp: "2026-05-31T23:59:59.999Z" }).passed).toBe(true);
  });

  it("fails an unparseable receipt timestamp", () => {
    const check = epoch({ timestamp: "not-a-date" });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/timestamp is (not|un)/iu);
  });

  it("fails when the manifest itself is invalid", () => {
    const check = epoch({ manifest: { schemaVersion: "wrong" } as unknown as KeyManifest });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/Key manifest is invalid/u);
  });

  it("fails when no entry exists for the keyId", () => {
    const check = epoch({ keyId: "unknown-key" });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/No manifest entry exists/u);
  });

  it("fails on an algorithm mismatch and names both", () => {
    const check = epoch({ algorithm: "LOCAL_HMAC_SHA256_DEV_ONLY" });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/No manifest entry exists|algorithm mismatch/u);
  });

  it("fails a REVOKED entry that carries no revokedAt timestamp", () => {
    // A revocation with no time cannot be reasoned about: nothing distinguishes
    // receipts made before it from receipts made after.
    const check = epoch({ manifest: manifest([entry({ status: "REVOKED" })]) });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/revoked without a revokedAt/u);
  });

  it("fails a receipt at or after revokedAt, and accepts one before it", () => {
    // The load-bearing rule: revocation is not retroactive. Receipts made BEFORE
    // the revocation stay verifiable; receipts dated at or after it do not.
    const revoked = manifest([entry({ status: "REVOKED", revokedAt: "2026-06-01T00:00:00.000Z" })]);
    expect(epoch({ manifest: revoked, timestamp: "2026-06-01T00:00:00.000Z" }).passed).toBe(false);
    expect(epoch({ manifest: revoked, timestamp: "2026-06-01T00:00:00.000Z" }).detail).toMatch(/at or after key revokedAt/u);
    expect(epoch({ manifest: revoked, timestamp: "2026-05-31T23:59:59.999Z" }).passed).toBe(true);
  });

  it("keeps a DEPRECATED key verifiable for historical receipts", () => {
    // Deprecation stops new signing, not old verification. A mutant treating
    // DEPRECATED like REVOKED would silently invalidate an audit trail.
    expect(epoch({ manifest: manifest([entry({ status: "DEPRECATED" })]) }).passed).toBe(true);
  });
});

describe("key manifest: signing authorization is stricter than verification", () => {
  const authorize = (over: Partial<Parameters<typeof verifyKeyManifestSigningAuthorization>[0]> = {}) =>
    verifyKeyManifestSigningAuthorization({
      manifest: manifest(),
      keyId: KEY,
      algorithm: ALG,
      signingTime: "2026-06-01T00:00:00.000Z",
      ...over
    });

  it("authorizes an ACTIVE key inside its epoch", () => {
    const check = authorize();
    expect(check.passed).toBe(true);
    expect(check.name).toBe("key_manifest_signing");
    expect(check.detail).toMatch(/is ACTIVE for signing/u);
  });

  it("refuses a DEPRECATED key even though it still VERIFIES", () => {
    // The asymmetry this module exists to encode, asserted in one place so it
    // cannot be collapsed in either direction.
    const deprecated = manifest([entry({ status: "DEPRECATED" })]);
    expect(epoch({ manifest: deprecated }).passed, "verification still passes").toBe(true);
    expect(authorize({ manifest: deprecated }).passed, "signing does not").toBe(false);
    expect(authorize({ manifest: deprecated }).detail).toMatch(/only ACTIVE keys may sign/u);
  });

  it("refuses a REVOKED key for signing", () => {
    const revoked = manifest([entry({ status: "REVOKED", revokedAt: "2026-07-01T00:00:00.000Z" })]);
    expect(authorize({ manifest: revoked }).passed).toBe(false);
  });

  it("refuses signing outside the key's epoch, quoting the epoch failure", () => {
    const check = authorize({ signingTime: "2025-01-01T00:00:00.000Z" });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/Signing is not authorized: /u);
    expect(check.detail).toMatch(/before key validFrom/u);
  });

  it("refuses signing against an unknown key or algorithm", () => {
    expect(authorize({ keyId: "unknown-key" }).passed).toBe(false);
    expect(authorize({ algorithm: "ROT13" }).passed).toBe(false);
  });

  it("refuses signing when the manifest is invalid", () => {
    const check = authorize({ manifest: { schemaVersion: "wrong" } as unknown as KeyManifest });
    expect(check.passed).toBe(false);
    expect(check.detail).toMatch(/not authorized/u);
  });
});
