const KMS_KEY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_KEY_ARN_PATTERN =
  /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KMS_ALIAS_ARN_PATTERN = /^arn:aws(?:-[a-z-]+)?:kms:[a-z0-9-]+:\d{12}:alias\/.+$/iu;

export function isKmsAliasKeyId(keyId: string): boolean {
  return keyId.startsWith("alias/") || KMS_ALIAS_ARN_PATTERN.test(keyId);
}

export function isImmutableKmsKeyId(keyId: string): boolean {
  return KMS_KEY_UUID_PATTERN.test(keyId) || KMS_KEY_ARN_PATTERN.test(keyId);
}

export function keyUuidFromImmutableKeyId(keyId: string): string {
  return keyId.includes(":key/") ? keyId.slice(keyId.lastIndexOf("/") + 1) : keyId;
}

export function immutableKmsKeyIdsMatch(first: string, second: string): boolean {
  if (!isImmutableKmsKeyId(first) || !isImmutableKmsKeyId(second)) {
    return false;
  }
  if (KMS_KEY_ARN_PATTERN.test(first) && KMS_KEY_ARN_PATTERN.test(second)) {
    return first === second;
  }
  return keyUuidFromImmutableKeyId(first) === keyUuidFromImmutableKeyId(second);
}

export function assertImmutableKmsKeyId(keyId: string, label: string): string {
  if (!isImmutableKmsKeyId(keyId)) {
    const mutableAliasHint = isKmsAliasKeyId(keyId) ? " Mutable aliases are not accepted for signed evidence." : "";
    throw new Error(`${label} must be an immutable KMS key ARN or key UUID.${mutableAliasHint}`);
  }
  return keyId;
}
