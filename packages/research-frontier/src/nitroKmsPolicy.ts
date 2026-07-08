import {
  type NitroAttestationManifest,
  hasRecommendedPcr8Coverage,
  validateNitroAttestationManifest,
} from "./nitroManifest";

export interface NitroKmsPolicyCondition {
  StringEqualsIgnoreCase: Record<string, string>;
}

export function buildNitroKmsAttestationCondition(
  manifest: NitroAttestationManifest,
): NitroKmsPolicyCondition {
  validateNitroAttestationManifest(manifest);

  const condition: Record<string, string> = {
    "kms:RecipientAttestation:ImageSha384":
      manifest.enclave_image.image_sha384,
    "kms:RecipientAttestation:PCR0": manifest.measurements.pcr0,
    "kms:RecipientAttestation:PCR1": manifest.measurements.pcr1,
    "kms:RecipientAttestation:PCR2": manifest.measurements.pcr2,
  };

  if (hasRecommendedPcr8Coverage(manifest) && manifest.measurements.pcr8) {
    condition["kms:RecipientAttestation:PCR8"] = manifest.measurements.pcr8;
  }

  return {
    StringEqualsIgnoreCase: condition,
  };
}

export function buildNitroKmsDecryptStatement(params: {
  sid: string;
  roleArn: string;
  keyActions?: string[];
  manifest: NitroAttestationManifest;
}): Record<string, unknown> {
  const actions = params.keyActions ?? ["kms:Decrypt"];

  return {
    Sid: params.sid,
    Effect: "Allow",
    Principal: {
      AWS: params.roleArn,
    },
    Action: actions,
    Resource: "*",
    Condition: buildNitroKmsAttestationCondition(params.manifest),
  };
}
