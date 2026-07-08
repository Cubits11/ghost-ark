import { describe, expect, it } from "vitest";
import {
  type NitroAttestationManifest,
  hasRecommendedPcr8Coverage,
  validateNitroAttestationManifest,
} from "../../../packages/research-frontier/src/nitroManifest";

const sha384A = "a".repeat(96);
const sha384B = "b".repeat(96);
const sha384C = "c".repeat(96);
const sha384D = "d".repeat(96);
const sha384E = "e".repeat(96);

function validManifest(): NitroAttestationManifest {
  return {
    schema_version: "ghostark.research.nitro_attestation_manifest.v1",
    enclave_image: {
      name: "ghost-ark-governed-runtime-dev.eif",
      image_sha384: sha384A,
      build_command:
        "nitro-cli build-enclave --docker-uri ghost-ark-governed-runtime:dev --output-file ghost-ark-governed-runtime-dev.eif",
    },
    measurements: {
      pcr0: sha384B,
      pcr1: sha384C,
      pcr2: sha384D,
      pcr8: sha384E,
    },
    kms_conditions: {
      required_condition_keys: [
        "kms:RecipientAttestation:ImageSha384",
        "kms:RecipientAttestation:PCR0",
        "kms:RecipientAttestation:PCR1",
        "kms:RecipientAttestation:PCR2",
        "kms:RecipientAttestation:PCR8",
      ],
    },
    non_claims: [
      "This does not prove model safety.",
      "This does not prove full formal policy correctness.",
    ],
  };
}

describe("Nitro attestation manifest validation", () => {
  it("accepts a manifest with image, PCR0, PCR1, PCR2, and PCR8 coverage", () => {
    const manifest = validManifest();

    expect(() => validateNitroAttestationManifest(manifest)).not.toThrow();
    expect(hasRecommendedPcr8Coverage(manifest)).toBe(true);
  });

  it("rejects invalid SHA-384 measurements", () => {
    const manifest = validManifest();
    manifest.measurements.pcr0 = "not-a-sha384";

    expect(() => validateNitroAttestationManifest(manifest)).toThrow(
      /pcr0 must be a SHA-384 hex digest/i,
    );
  });

  it("rejects manifests missing required KMS condition keys", () => {
    const manifest = validManifest();
    manifest.kms_conditions.required_condition_keys = [
      "kms:RecipientAttestation:ImageSha384",
      "kms:RecipientAttestation:PCR0",
      "kms:RecipientAttestation:PCR1",
    ];

    expect(() => validateNitroAttestationManifest(manifest)).toThrow(
      /Missing required Nitro KMS condition key: kms:RecipientAttestation:PCR2/i,
    );
  });

  it("allows PCR8 to be absent but does not report recommended coverage", () => {
    const manifest = validManifest();
    delete manifest.measurements.pcr8;
    manifest.kms_conditions.required_condition_keys =
      manifest.kms_conditions.required_condition_keys.filter(
        (key) => key !== "kms:RecipientAttestation:PCR8",
      );

    expect(() => validateNitroAttestationManifest(manifest)).not.toThrow();
    expect(hasRecommendedPcr8Coverage(manifest)).toBe(false);
  });

  it("requires explicit non-claims", () => {
    const manifest = validManifest();
    manifest.non_claims = [];

    expect(() => validateNitroAttestationManifest(manifest)).toThrow(
      /must include non-claims/i,
    );
  });
});
