export interface NitroAttestationManifest {
  schema_version: "ghostark.research.nitro_attestation_manifest.v1";
  enclave_image: {
    name: string;
    image_sha384: string;
    build_command: string;
  };
  measurements: {
    pcr0: string;
    pcr1: string;
    pcr2: string;
    pcr8?: string;
  };
  kms_conditions: {
    required_condition_keys: string[];
  };
  non_claims: string[];
}

export const REQUIRED_NITRO_KMS_CONDITION_KEYS = [
  "kms:RecipientAttestation:ImageSha384",
  "kms:RecipientAttestation:PCR0",
  "kms:RecipientAttestation:PCR1",
  "kms:RecipientAttestation:PCR2",
] as const;

export const RECOMMENDED_NITRO_KMS_CONDITION_KEYS = [
  "kms:RecipientAttestation:PCR8",
] as const;

export function assertSha384Hex(value: string, label: string): void {
  if (!/^[a-fA-F0-9]{96}$/.test(value)) {
    throw new Error(`${label} must be a SHA-384 hex digest`);
  }
}

export function assertRequiredPcrsPresent(
  manifest: NitroAttestationManifest,
): void {
  assertSha384Hex(manifest.enclave_image.image_sha384, "image_sha384");
  assertSha384Hex(manifest.measurements.pcr0, "pcr0");
  assertSha384Hex(manifest.measurements.pcr1, "pcr1");
  assertSha384Hex(manifest.measurements.pcr2, "pcr2");

  if (manifest.measurements.pcr8 !== undefined) {
    assertSha384Hex(manifest.measurements.pcr8, "pcr8");
  }
}

export function assertKmsConditionCoverage(
  manifest: NitroAttestationManifest,
): void {
  const keys = new Set(manifest.kms_conditions.required_condition_keys);

  for (const required of REQUIRED_NITRO_KMS_CONDITION_KEYS) {
    if (!keys.has(required)) {
      throw new Error(`Missing required Nitro KMS condition key: ${required}`);
    }
  }
}

export function validateNitroAttestationManifest(
  manifest: NitroAttestationManifest,
): void {
  if (
    manifest.schema_version !==
    "ghostark.research.nitro_attestation_manifest.v1"
  ) {
    throw new Error("Invalid Nitro attestation manifest schema version");
  }

  if (!manifest.enclave_image.name) {
    throw new Error("Nitro manifest enclave image name is required");
  }

  if (!manifest.enclave_image.build_command) {
    throw new Error("Nitro manifest build command is required");
  }

  assertRequiredPcrsPresent(manifest);
  assertKmsConditionCoverage(manifest);

  if (manifest.non_claims.length === 0) {
    throw new Error("Nitro manifest must include non-claims");
  }
}

export function hasRecommendedPcr8Coverage(
  manifest: NitroAttestationManifest,
): boolean {
  return (
    manifest.measurements.pcr8 !== undefined &&
    manifest.kms_conditions.required_condition_keys.includes(
      "kms:RecipientAttestation:PCR8",
    )
  );
}
