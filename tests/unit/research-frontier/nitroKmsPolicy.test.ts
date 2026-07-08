import { describe, expect, it } from "vitest";
import {
  buildNitroKmsAttestationCondition,
  buildNitroKmsDecryptStatement,
} from "../../../packages/research-frontier/src/nitroKmsPolicy";
import { type NitroAttestationManifest } from "../../../packages/research-frontier/src/nitroManifest";

const sha384A = "a".repeat(96);
const sha384B = "b".repeat(96);
const sha384C = "c".repeat(96);
const sha384D = "d".repeat(96);
const sha384E = "e".repeat(96);

function manifest(): NitroAttestationManifest {
  return {
    schema_version: "ghostark.research.nitro_attestation_manifest.v1",
    enclave_image: {
      name: "ghost-ark-governed-runtime-dev.eif",
      image_sha384: sha384A,
      build_command: "nitro-cli build-enclave --docker-uri ghost-ark:dev",
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
    non_claims: ["This does not prove model safety."],
  };
}

describe("Nitro KMS policy condition generation", () => {
  it("generates KMS recipient attestation conditions from measurements", () => {
    const condition = buildNitroKmsAttestationCondition(manifest());

    expect(condition.StringEqualsIgnoreCase).toMatchObject({
      "kms:RecipientAttestation:ImageSha384": sha384A,
      "kms:RecipientAttestation:PCR0": sha384B,
      "kms:RecipientAttestation:PCR1": sha384C,
      "kms:RecipientAttestation:PCR2": sha384D,
      "kms:RecipientAttestation:PCR8": sha384E,
    });
  });

  it("omits PCR8 when recommended PCR8 coverage is not present", () => {
    const m = manifest();
    delete m.measurements.pcr8;
    m.kms_conditions.required_condition_keys =
      m.kms_conditions.required_condition_keys.filter(
        (key) => key !== "kms:RecipientAttestation:PCR8",
      );

    const condition = buildNitroKmsAttestationCondition(m);

    expect(
      condition.StringEqualsIgnoreCase["kms:RecipientAttestation:PCR8"],
    ).toBeUndefined();
  });

  it("builds a decrypt statement scoped to a role and attestation condition", () => {
    const statement = buildNitroKmsDecryptStatement({
      sid: "AllowDecryptFromMeasuredGhostArkEnclave",
      roleArn: "arn:aws:iam::123456789012:role/GhostArkEnclaveParentRole",
      manifest: manifest(),
    });

    expect(statement).toMatchObject({
      Sid: "AllowDecryptFromMeasuredGhostArkEnclave",
      Effect: "Allow",
      Principal: {
        AWS: "arn:aws:iam::123456789012:role/GhostArkEnclaveParentRole",
      },
      Action: ["kms:Decrypt"],
      Resource: "*",
    });

    expect(JSON.stringify(statement)).toContain(
      "kms:RecipientAttestation:ImageSha384",
    );
  });

  it("rejects invalid manifests before generating policy", () => {
    const m = manifest();
    m.measurements.pcr2 = "bad";

    expect(() => buildNitroKmsAttestationCondition(m)).toThrow(
      /pcr2 must be a SHA-384 hex digest/i,
    );
  });
});
