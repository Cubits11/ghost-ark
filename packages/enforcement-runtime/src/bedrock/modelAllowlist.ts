import { ValidationError } from "../../../shared/src/errors";

export function parseModelAllowlist(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
      throw new ValidationError("GHOST_ARK_BEDROCK_MODEL_ALLOWLIST must be a JSON string array or comma-separated list");
    }
    return parsed.map((entry) => entry.trim());
  }

  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isModelAllowed(modelId: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(modelId);
}

export function assertModelAllowed(modelId: string, allowlist: readonly string[]): void {
  if (!isModelAllowed(modelId, allowlist)) {
    throw new ValidationError("Requested Bedrock model is not in the governed invoke allowlist", { modelId });
  }
}
