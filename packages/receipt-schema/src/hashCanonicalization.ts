import { createHash } from "crypto";
import { ValidationError } from "../../shared/src/errors";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJson = CanonicalJsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

const undefinedValueMessage = "Canonical JSON cannot encode undefined values. Use explicit null or omit the key structurally.";

function undefinedValueError(context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(undefinedValueMessage, { type: "undefined_value_encountered", ...context });
}

function assertPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalize(value: unknown): string {
  if (value === undefined) {
    throw undefinedValueError();
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError("Canonical JSON cannot encode non-finite numbers", { value });
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (item === undefined) {
        throw undefinedValueError({ index });
      }
      items.push(canonicalize(item));
    }
    return `[${items.join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (assertPlainObject(value)) {
    const entries = Object.entries(value);
    for (const [key, entryValue] of entries) {
      if (entryValue === undefined) {
        throw undefinedValueError({ key });
      }
    }
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(",")}}`;
  }
  throw new ValidationError("Unsupported value in canonical JSON payload", {
    type: typeof value,
    constructor: value && typeof value === "object" ? value.constructor?.name : undefined
  });
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Bytes(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

export function canonicalSha256Hex(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

export function evidenceObjectId(value: unknown): string {
  return `ev_${canonicalSha256Hex(value)}`;
}

export function receiptIdFromPayload(value: unknown): string {
  return `rct_${canonicalSha256Hex(value)}`;
}

export function claimIdFromPayload(value: unknown): string {
  return `clm_${canonicalSha256Hex(value)}`;
}

export function lineageEventIdFromPayload(value: unknown): string {
  return `lin_${canonicalSha256Hex(value)}`;
}
