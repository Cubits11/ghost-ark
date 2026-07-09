import { createHash } from "crypto";
import { ValidationError } from "../../shared/src/errors";

export type CanonicalJsonPrimitive = string | number | boolean | null;
export type CanonicalJson = CanonicalJsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

const undefinedValueMessage = "Canonical JSON cannot encode undefined values. Use explicit null or omit the key structurally.";

function canonicalizationError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.canonical_json.v1", ...context });
}

function undefinedValueError(context: Record<string, unknown> = {}): ValidationError {
  return canonicalizationError(undefinedValueMessage, { type: "undefined_value_encountered", ...context });
}

function assertPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf16LexicographicCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Deterministic canonical JSON serializer for Ghost-Ark evidence payloads.
 *
 * Boundary:
 * - Accepts JSON-shaped values only: null, boolean, finite number, string, array, and plain object.
 * - Rejects undefined, sparse arrays, functions, symbols, bigint, Date, Buffer, Uint8Array, Map, Set, class instances,
 *   and objects with custom prototypes.
 * - Sorts object keys deterministically.
 * - Emits no insignificant whitespace.
 *
 * Important:
 * This function intentionally rejects host-runtime objects. Evidence payloads must be converted into explicit
 * JSON-shaped schemas before signing or hashing.
 */
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
      throw canonicalizationError("Canonical JSON cannot encode non-finite numbers", { value });
    }

    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    throw canonicalizationError("Canonical JSON cannot encode bigint values", { type: "bigint" });
  }

  if (typeof value === "function" || typeof value === "symbol") {
    throw canonicalizationError("Canonical JSON cannot encode executable or symbolic values", { type: typeof value });
  }

  if (Array.isArray(value)) {
    const items: string[] = [];

    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw canonicalizationError("Canonical JSON cannot encode sparse arrays", { index });
      }

      const item = value[index];
      if (item === undefined) {
        throw undefinedValueError({ index });
      }

      items.push(canonicalize(item));
    }

    return `[${items.join(",")}]`;
  }

  if (value instanceof Date) {
    throw canonicalizationError("Canonical JSON cannot encode Date objects. Serialize timestamps as schema-owned ISO strings before signing.", {
      constructor: "Date"
    });
  }

  if (Buffer.isBuffer(value)) {
    throw canonicalizationError("Canonical JSON cannot encode Buffer values. Encode bytes explicitly before signing.", {
      constructor: "Buffer"
    });
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    throw canonicalizationError("Canonical JSON cannot encode binary view values. Encode bytes explicitly before signing.", {
      constructor: value.constructor?.name
    });
  }

  if (value instanceof Map || value instanceof Set) {
    throw canonicalizationError("Canonical JSON cannot encode Map or Set values. Convert them to explicit schema objects before signing.", {
      constructor: value.constructor.name
    });
  }

  if (assertPlainObject(value)) {
    const entries = Object.entries(value);

    for (const [key, entryValue] of entries) {
      if (entryValue === undefined) {
        throw undefinedValueError({ key });
      }
    }

    entries.sort(([left], [right]) => utf16LexicographicCompare(left, right));

    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(",")}}`;
  }

  throw canonicalizationError("Unsupported value in canonical JSON payload", {
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