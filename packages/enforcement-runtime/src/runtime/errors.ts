export type GovernedInvokeFailureCode =
  | "missing_identity"
  | "tenant_mismatch"
  | "client_declared_identity"
  | "policy_failure"
  | "retrieval_contamination"
  | "model_failure"
  | "memory_failure"
  | "receipt_failure";

export class GovernedInvokeError extends Error {
  readonly code: GovernedInvokeFailureCode;

  constructor(code: GovernedInvokeFailureCode, message: string) {
    super(message);
    this.name = "GovernedInvokeError";
    this.code = code;
  }
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
