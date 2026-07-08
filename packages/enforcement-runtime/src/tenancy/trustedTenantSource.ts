import { tenantSlugSchema } from "../../../receipt-schema/src/receipt";
import { AuthorizationError, ValidationError } from "../../../shared/src/errors";

export type TrustedTenantSourceKind = "s3" | "sqs" | "glue";

export interface TrustedTenantSourceAssertion {
  kind: TrustedTenantSourceKind;
  declaredTenantSlug: unknown;
  sourceArn?: string;
  sourceName?: string;
  key?: string;
  inputPath?: string;
  outputPath?: string;
}

export interface TrustedTenantSourceEntry {
  kind?: TrustedTenantSourceKind;
  tenantSlug: string;
  sourceArn?: string;
  sourceName?: string;
  keyPrefix?: string;
  inputPrefix?: string;
  outputPrefix?: string;
}

const TRUSTED_TENANT_SOURCES_ENV = "GHOST_ARK_TRUSTED_TENANT_SOURCES";

export function parseTrustedTenantSources(env: NodeJS.ProcessEnv = process.env): TrustedTenantSourceEntry[] {
  const raw = env[TRUSTED_TENANT_SOURCES_ENV];
  if (!raw || raw.trim().length === 0) {
    throw new ValidationError("Missing trusted tenant source registry", { name: TRUSTED_TENANT_SOURCES_ENV });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ValidationError("Trusted tenant source registry must be valid JSON", {
      name: TRUSTED_TENANT_SOURCES_ENV,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError("Trusted tenant source registry must be a JSON array", { name: TRUSTED_TENANT_SOURCES_ENV });
  }

  return parsed.map((entry, index) => parseTrustedTenantSourceEntry(entry, index));
}

export function assertTrustedTenantSource(
  assertion: TrustedTenantSourceAssertion,
  env: NodeJS.ProcessEnv = process.env
): string {
  const declaredTenant = tenantSlugSchema.safeParse(assertion.declaredTenantSlug);
  if (!declaredTenant.success) {
    throw new ValidationError("Invalid declared tenant slug", { issues: declaredTenant.error.issues });
  }

  const entries = parseTrustedTenantSources(env);
  const match = entries.find((entry) => trustedSourceEntryMatches(entry, assertion, declaredTenant.data));
  if (!match) {
    throw new AuthorizationError("Tenant source is not trusted for declared tenant", {
      kind: assertion.kind,
      declaredTenantSlug: declaredTenant.data,
      sourceArn: assertion.sourceArn,
      sourceName: assertion.sourceName,
      key: assertion.key,
      inputPath: assertion.inputPath,
      outputPath: assertion.outputPath
    });
  }

  return declaredTenant.data;
}

function parseTrustedTenantSourceEntry(value: unknown, index: number): TrustedTenantSourceEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Trusted tenant source entry must be an object", { index });
  }
  const entry = value as Record<string, unknown>;
  const tenantSlug = tenantSlugSchema.safeParse(entry.tenantSlug);
  if (!tenantSlug.success) {
    throw new ValidationError("Trusted tenant source entry has invalid tenantSlug", {
      index,
      issues: tenantSlug.error.issues
    });
  }
  const kind = optionalString(entry.kind);
  if (kind !== undefined && kind !== "s3" && kind !== "sqs" && kind !== "glue") {
    throw new ValidationError("Trusted tenant source entry has invalid kind", { index, kind });
  }

  const parsed: TrustedTenantSourceEntry = {
    tenantSlug: tenantSlug.data,
    ...(kind ? { kind } : {}),
    ...optionalField("sourceArn", entry.sourceArn),
    ...optionalField("sourceName", entry.sourceName),
    ...optionalField("keyPrefix", entry.keyPrefix),
    ...optionalField("inputPrefix", entry.inputPrefix),
    ...optionalField("outputPrefix", entry.outputPrefix)
  };

  if (!parsed.sourceArn && !parsed.sourceName) {
    throw new ValidationError("Trusted tenant source entry must include sourceArn or sourceName", { index });
  }
  return parsed;
}

function trustedSourceEntryMatches(
  entry: TrustedTenantSourceEntry,
  assertion: TrustedTenantSourceAssertion,
  declaredTenantSlug: string
): boolean {
  if (entry.kind && entry.kind !== assertion.kind) {
    return false;
  }
  if (entry.tenantSlug !== declaredTenantSlug) {
    return false;
  }
  if (entry.sourceArn && assertion.sourceArn !== entry.sourceArn) {
    return false;
  }
  if (entry.sourceName && assertion.sourceName !== entry.sourceName) {
    return false;
  }
  if (entry.keyPrefix && !assertion.key?.startsWith(entry.keyPrefix)) {
    return false;
  }
  if (entry.inputPrefix && !assertion.inputPath?.startsWith(entry.inputPrefix)) {
    return false;
  }
  if (entry.outputPrefix && !assertion.outputPath?.startsWith(entry.outputPrefix)) {
    return false;
  }
  return Boolean(entry.sourceArn || entry.sourceName);
}

function optionalField(name: keyof TrustedTenantSourceEntry, value: unknown): Partial<TrustedTenantSourceEntry> {
  const parsed = optionalString(value);
  return parsed ? { [name]: parsed } : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
