export type ErrorContext = Record<string, unknown>;

export class GhostArkError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly context: ErrorContext;

  constructor(message: string, options: { code: string; statusCode?: number; context?: ErrorContext }) {
    super(message);
    this.name = "GhostArkError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.context = options.context ?? {};
  }
}

export class ValidationError extends GhostArkError {
  constructor(message: string, context?: ErrorContext) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, context });
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends GhostArkError {
  constructor(message: string, context?: ErrorContext) {
    super(message, { code: "AUTHORIZATION_ERROR", statusCode: 403, context });
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends GhostArkError {
  constructor(message: string, context?: ErrorContext) {
    super(message, { code: "NOT_FOUND", statusCode: 404, context });
    this.name = "NotFoundError";
  }
}

export function errorResponse(error: unknown): { statusCode: number; body: string; headers: Record<string, string> } {
  const normalized =
    error instanceof GhostArkError
      ? error
      : new GhostArkError(error instanceof Error ? error.message : "Unknown error", { code: "INTERNAL_ERROR" });

  return {
    statusCode: normalized.statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify({
      error: {
        code: normalized.code,
        message: normalized.message,
        context: normalized.context
      }
    })
  };
}
