import { spawnSync } from "child_process";
import {
  RuntimeAttestation,
  RuntimeAttestationSignatureVerificationResult,
  RuntimeAttestationSignatureVerifier,
  RuntimeAttestationType,
  validateRuntimeAttestation
} from "./runtimeAttestation";

export interface ExternalRuntimeAttestationVerifierInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly supportedTypes?: readonly RuntimeAttestationType[];
  readonly supportedAlgorithms?: readonly RuntimeAttestation["signature"]["algorithm"][];
}

interface ExternalVerifierResponse {
  readonly verdict?: unknown;
  readonly passed?: unknown;
  readonly detail?: unknown;
}

function parseVerifierResponse(stdout: string): RuntimeAttestationSignatureVerificationResult {
  const parsed = JSON.parse(stdout) as ExternalVerifierResponse;
  const passed = typeof parsed.passed === "boolean" ? parsed.passed : parsed.verdict === true;
  return {
    passed,
    detail: typeof parsed.detail === "string" ? parsed.detail : "External runtime attestation verifier completed."
  };
}

export class ExternalRuntimeAttestationVerifier implements RuntimeAttestationSignatureVerifier {
  readonly supportedAlgorithms: readonly RuntimeAttestation["signature"]["algorithm"][];
  readonly supportedTypes: readonly RuntimeAttestationType[];

  private readonly command: string;
  private readonly args: readonly string[];
  private readonly timeoutMs: number;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(input: ExternalRuntimeAttestationVerifierInput) {
    if (input.command.length === 0) {
      throw new Error("External runtime attestation verifier command must be non-empty.");
    }
    this.command = input.command;
    this.args = input.args ?? [];
    this.timeoutMs = input.timeoutMs ?? 10_000;
    this.env = input.env;
    this.supportedTypes = input.supportedTypes ?? ["aws-nitro-enclave"];
    this.supportedAlgorithms = input.supportedAlgorithms ?? ["aws-nitro-attestation"];
  }

  verify(input: { attestation: RuntimeAttestation }): RuntimeAttestationSignatureVerificationResult {
    const attestation = validateRuntimeAttestation(input.attestation);
    const child = spawnSync(this.command, [...this.args], {
      input: JSON.stringify({
        schemaVersion: "ghost.external_runtime_attestation_verifier_request.v1",
        attestation
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
        detail: child.stderr.trim() || `External runtime attestation verifier exited with status ${child.status ?? "unknown"}.`
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
