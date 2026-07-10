import fs from "fs";
import { z } from "zod";

export const keyManifestSchemaVersion = "ghost.key_manifest.v1" as const;
export const keyManifestStatuses = ["ACTIVE", "DEPRECATED", "REVOKED"] as const;

export const keyManifestEntrySchema = z.object({
  keyId: z.string().min(1),
  algorithm: z.string().min(1),
  publicKeyPem: z.string().min(1).optional(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().optional(),
  status: z.enum(keyManifestStatuses),
  revokedAt: z.string().datetime().optional(),
  reason: z.string().optional()
});

export const keyManifestSchema = z.object({
  schemaVersion: z.literal(keyManifestSchemaVersion),
  generatedAt: z.string().datetime(),
  keys: z.array(keyManifestEntrySchema).min(1)
}).superRefine((manifest, ctx) => {
  const seen = new Set<string>();
  for (const [index, entry] of manifest.keys.entries()) {
    const identity = `${entry.keyId}:${entry.algorithm}`;
    if (seen.has(identity)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "keyId"],
        message: `Duplicate key manifest entry for ${identity}`
      });
    }
    seen.add(identity);

    const validFrom = Date.parse(entry.validFrom);
    const validUntil = entry.validUntil ? Date.parse(entry.validUntil) : undefined;
    const revokedAt = entry.revokedAt ? Date.parse(entry.revokedAt) : undefined;
    if (validUntil !== undefined && validUntil <= validFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "validUntil"],
        message: "validUntil must be later than validFrom"
      });
    }
    if (revokedAt !== undefined && revokedAt < validFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "revokedAt"],
        message: "revokedAt cannot be earlier than validFrom"
      });
    }
  }
});

export type KeyManifestEntry = z.infer<typeof keyManifestEntrySchema>;
export type KeyManifest = z.infer<typeof keyManifestSchema>;

export interface KeyManifestCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export function validateKeyManifest(value: unknown): KeyManifest {
  return keyManifestSchema.parse(value);
}

export function readKeyManifestFile(filePath: string): KeyManifest {
  return validateKeyManifest(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function findManifestEntryForKey(manifest: KeyManifest, keyId: string, algorithm: string): KeyManifestEntry | null {
  return (
    manifest.keys.find((entry) => entry.keyId === keyId && entry.algorithm === algorithm) ??
    manifest.keys.find((entry) => entry.keyId === keyId) ??
    null
  );
}

export function verifyKeyManifestEpoch(input: {
  manifest: KeyManifest;
  keyId: string;
  algorithm: string;
  timestamp: string;
}): KeyManifestCheck {
  let manifest: KeyManifest;
  try {
    manifest = validateKeyManifest(input.manifest);
  } catch (error) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Key manifest is invalid: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const entry = findManifestEntryForKey(manifest, input.keyId, input.algorithm);
  if (!entry) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `No manifest entry exists for keyId ${input.keyId}.`
    };
  }
  if (entry.algorithm !== input.algorithm) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Manifest algorithm mismatch. Expected ${entry.algorithm}; observed ${input.algorithm}.`
    };
  }

  const timestamp = Date.parse(input.timestamp);
  const validFrom = Date.parse(entry.validFrom);
  const validUntil = entry.validUntil ? Date.parse(entry.validUntil) : Number.POSITIVE_INFINITY;
  const revokedAt = entry.revokedAt ? Date.parse(entry.revokedAt) : undefined;

  if (!Number.isFinite(timestamp)) {
    return { name: "key_manifest", passed: false, detail: `Receipt timestamp is not parseable: ${input.timestamp}.` };
  }
  if (timestamp < validFrom) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Receipt timestamp ${input.timestamp} is before key validFrom ${entry.validFrom}.`
    };
  }
  if (timestamp >= validUntil) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Receipt timestamp ${input.timestamp} is not before key validUntil ${entry.validUntil}.`
    };
  }
  if (entry.status === "REVOKED" && revokedAt === undefined) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Manifest key ${entry.keyId} is revoked without a revokedAt timestamp.`
    };
  }
  if (revokedAt !== undefined && timestamp >= revokedAt) {
    return {
      name: "key_manifest",
      passed: false,
      detail: `Receipt timestamp ${input.timestamp} is at or after key revokedAt ${entry.revokedAt}.`
    };
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

/**
 * Authorizes a signing operation against the current manifest snapshot.
 * Verification and signing intentionally have different rules: historical
 * receipts may remain verifiable after succession or revocation, while only an
 * ACTIVE key may create a new signature.
 */
export function verifyKeyManifestSigningAuthorization(input: {
  manifest: KeyManifest;
  keyId: string;
  algorithm: string;
  signingTime: string;
}): KeyManifestCheck {
  const epochCheck = verifyKeyManifestEpoch({
    manifest: input.manifest,
    keyId: input.keyId,
    algorithm: input.algorithm,
    timestamp: input.signingTime
  });
  if (!epochCheck.passed) {
    return {
      name: "key_manifest_signing",
      passed: false,
      detail: `Signing is not authorized: ${epochCheck.detail}`
    };
  }

  let manifest: KeyManifest;
  try {
    manifest = validateKeyManifest(input.manifest);
  } catch (error) {
    return {
      name: "key_manifest_signing",
      passed: false,
      detail: `Signing is not authorized because the key manifest is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }

  const entry = findManifestEntryForKey(manifest, input.keyId, input.algorithm);
  if (!entry || entry.algorithm !== input.algorithm) {
    return {
      name: "key_manifest_signing",
      passed: false,
      detail: `Signing is not authorized for keyId ${input.keyId} and algorithm ${input.algorithm}.`
    };
  }
  if (entry.status !== "ACTIVE") {
    return {
      name: "key_manifest_signing",
      passed: false,
      detail: `Key ${entry.keyId} is ${entry.status}; only ACTIVE keys may sign new receipts.`
    };
  }

  return {
    name: "key_manifest_signing",
    passed: true,
    detail: `Key ${entry.keyId} is ACTIVE for signing at ${input.signingTime}.`
  };
}
