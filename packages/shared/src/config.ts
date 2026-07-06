import { ValidationError } from "./errors";

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new ValidationError(`Missing required environment variable ${name}`, { name });
  }
  return value;
}

export function optionalEnv(name: string, fallback: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

export function parseCsvEnv(name: string, fallback: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] {
  const value = env[name];
  if (!value) {
    return fallback;
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface RuntimeConfig {
  stage: string;
  awsRegion: string;
  receiptTableName: string;
  claimTableName: string;
  lineageTableName: string;
  signingKeyId: string;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    stage: optionalEnv("STAGE", "dev", env),
    awsRegion: optionalEnv("AWS_REGION", "us-east-1", env),
    receiptTableName: requiredEnv("RECEIPT_LEDGER_TABLE", env),
    claimTableName: requiredEnv("CLAIM_LEDGER_TABLE", env),
    lineageTableName: requiredEnv("LINEAGE_LEDGER_TABLE", env),
    signingKeyId: requiredEnv("KMS_SIGNING_KEY_ID", env)
  };
}
