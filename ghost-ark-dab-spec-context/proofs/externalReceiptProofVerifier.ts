import { spawnSync } from "child_process";
import {
  ReceiptProof,
  ReceiptProofBackendVerification,
  ReceiptProofBackendVerifier,
  ReceiptProofSystem,
  validateReceiptProof
} from "./receiptProof";

export interface ExternalReceiptProofVerifierInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly supportedProofSystems: readonly ReceiptProofSystem[];
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

interface ExternalVerifierResponse {
  readonly verdict?: unknown;
  readonly passed?: unknown;
  readonly detail?: unknown;
}

function parseVerifierResponse(stdout: string): ReceiptProofBackendVerification {
  const parsed = JSON.parse(stdout) as ExternalVerifierResponse;
  const passed = typeof parsed.passed === "boolean" ? parsed.passed : parsed.verdict === true;
  return {
    passed,
    detail: typeof parsed.detail === "string" ? parsed.detail : "External receipt proof verifier completed."
  };
}

export class ExternalReceiptProofVerifier implements ReceiptProofBackendVerifier {
  readonly supportedProofSystems: readonly ReceiptProofSystem[];

  private readonly command: string;
  private readonly args: readonly string[];
  private readonly timeoutMs: number;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(input: ExternalReceiptProofVerifierInput) {
    if (input.command.length === 0) {
      throw new Error("External receipt proof verifier command must be non-empty.");
    }
    if (input.supportedProofSystems.length === 0) {
      throw new Error("External receipt proof verifier must support at least one proof system.");
    }
    this.command = input.command;
    this.args = input.args ?? [];
    this.supportedProofSystems = input.supportedProofSystems;
    this.timeoutMs = input.timeoutMs ?? 10_000;
    this.env = input.env;
  }

  verify(input: { proof: ReceiptProof }): ReceiptProofBackendVerification {
    const proof = validateReceiptProof(input.proof);
    const child = spawnSync(this.command, [...this.args], {
      input: JSON.stringify({
        schemaVersion: "ghost.external_receipt_proof_verifier_request.v1",
        proof
      }),
      encoding: "utf8",
      timeout: this.timeoutMs,
      env: this.env ? { ...process.env, ...this.env } : process.env,
      maxBuffer: 1024 * 1024
    });

    if (child.error) {
      throw child.error;
    }
    if (child.status !== 0) {
      return {
        passed: false,
        detail: child.stderr.trim() || `External receipt proof verifier exited with status ${child.status ?? "unknown"}.`
      };
    }
    try {
      return parseVerifierResponse(child.stdout);
    } catch (error) {
      return {
        passed: false,
        detail: error instanceof Error ? `External verifier returned invalid JSON: ${error.message}` : "External verifier returned invalid JSON."
      };
    }
  }
}
