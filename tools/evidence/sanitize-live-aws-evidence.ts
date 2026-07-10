#!/usr/bin/env node
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  formatEvidenceBundleValidationIssues,
  redactKnownSensitivePatterns,
  sensitiveEvidenceKey,
  validateLiveAwsEvidenceBundle
} from "./liveAwsEvidenceBundle";

export const EVIDENCE_SANITIZER_VERSION = "ghost-ark-evidence-sanitizer/1.0.0" as const;

export interface ExplicitEvidenceRedaction {
  label: string;
  value: string;
}

export interface SanitizeEvidenceOptions {
  sourceBytes: Buffer;
  explicitRedactions?: ExplicitEvidenceRedaction[];
  sanitizedAt?: string;
}

export interface SanitizedEvidenceResult {
  bundle: Record<string, unknown>;
  redactedPaths: string[];
  redactionLabels: string[];
}

interface SanitizationState {
  explicitRedactions: ExplicitEvidenceRedaction[];
  redactedPaths: Set<string>;
  redactionLabels: Set<string>;
}

interface CliArgs {
  input?: string;
  output?: string;
  redactionFile?: string;
  force: boolean;
  help: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function validateExplicitRedactions(redactions: ExplicitEvidenceRedaction[]): void {
  const labels = new Set<string>();
  for (const redaction of redactions) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(redaction.label)) {
      throw new Error(`Invalid redaction label ${JSON.stringify(redaction.label)}`);
    }
    if (redaction.value.length === 0) {
      throw new Error(`Redaction ${redaction.label} has an empty value`);
    }
    if (labels.has(redaction.label)) {
      throw new Error(`Duplicate redaction label ${redaction.label}`);
    }
    labels.add(redaction.label);
  }
}

function sanitizeString(value: string, pathName: string, state: SanitizationState): string {
  let sanitized = value;
  for (const redaction of state.explicitRedactions) {
    if (sanitized.includes(redaction.value)) {
      sanitized = sanitized.split(redaction.value).join(`[REDACTED:${redaction.label}]`);
      state.redactedPaths.add(pathName);
      state.redactionLabels.add(redaction.label);
    }
  }
  const knownPatternResult = redactKnownSensitivePatterns(sanitized);
  if (knownPatternResult.value !== sanitized) {
    state.redactedPaths.add(pathName);
    knownPatternResult.labels.forEach((label) => state.redactionLabels.add(label));
  }
  return knownPatternResult.value;
}

function sanitizeValue(value: unknown, pathName: string, state: SanitizationState): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, pathName, state);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValue(entry, `${pathName}[${index}]`, state));
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = childPath(pathName, key);
    if (sensitiveEvidenceKey(key)) {
      state.redactedPaths.add(entryPath);
      state.redactionLabels.add("sensitive-field");
      continue;
    }
    sanitized[key] = sanitizeValue(entry, entryPath, state);
  }
  return sanitized;
}

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sanitizeLiveAwsEvidenceBundle(
  candidate: unknown,
  options: SanitizeEvidenceOptions
): SanitizedEvidenceResult {
  if (!isRecord(candidate)) {
    throw new Error("Evidence candidate must be a JSON object");
  }
  const explicitRedactions = options.explicitRedactions ?? [];
  validateExplicitRedactions(explicitRedactions);

  const candidateWithoutPreviousMetadata = { ...candidate };
  delete candidateWithoutPreviousMetadata.sanitization;
  const state: SanitizationState = {
    explicitRedactions,
    redactedPaths: new Set(),
    redactionLabels: new Set()
  };
  const sanitized = sanitizeValue(candidateWithoutPreviousMetadata, "$", state);
  if (!isRecord(sanitized)) {
    throw new Error("Sanitizer produced a non-object result");
  }

  const redactedPaths = [...state.redactedPaths].sort();
  const redactionLabels = [...state.redactionLabels].sort();
  sanitized.sanitization = {
    status: "PASS",
    toolVersion: EVIDENCE_SANITIZER_VERSION,
    sanitizedAt: options.sanitizedAt ?? new Date().toISOString(),
    sourceDigest: sha256(options.sourceBytes),
    redactedPaths,
    redactionLabels,
    leakScanStatus: "PASS"
  };

  const validation = validateLiveAwsEvidenceBundle(sanitized);
  if (!validation.valid) {
    throw new Error(`Sanitized bundle is invalid:\n${formatEvidenceBundleValidationIssues(validation.issues)}`);
  }
  return { bundle: sanitized, redactedPaths, redactionLabels };
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--input" && next) {
      args.input = next;
      index += 1;
    } else if (current === "--output" && next) {
      args.output = next;
      index += 1;
    } else if (current === "--redaction-file" && next) {
      args.redactionFile = next;
      index += 1;
    } else if (current === "--force") {
      args.force = true;
    } else if (current === "--help" || current === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${current}`);
    }
  }
  return args;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run sanitize:evidence-bundle -- --input <raw.json> --output <sanitized.json> [--redaction-file <private.json>] [--force]",
    "",
    "The optional redaction file must be a JSON object mapping safe labels to exact raw values.",
    "Keep raw captures and redaction files outside the repository; the command never prints their values."
  ].join("\n");
}

function readRedactionFile(filePath: string | undefined): ExplicitEvidenceRedaction[] {
  if (!filePath) {
    return [];
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) {
    throw new Error("Redaction file must be a JSON object whose values are strings");
  }
  return Object.entries(parsed).map(([label, value]) => ({ label, value: value as string }));
}

function writeAtomically(outputPath: string, content: string, force: boolean): void {
  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`Refusing to overwrite existing output ${outputPath}; pass --force only after review`);
  }
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, outputPath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    throw error;
  }
}

export function runSanitizerCli(argv: string[]): void {
  const args = parseCliArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.input || !args.output) {
    throw new Error(`${usage()}\n\nBoth --input and --output are required.`);
  }
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  if (inputPath === outputPath) {
    throw new Error("Input and output paths must differ so the raw capture is never overwritten");
  }
  if (!fs.existsSync(path.dirname(outputPath))) {
    throw new Error(`Output directory does not exist: ${path.dirname(outputPath)}`);
  }

  const sourceBytes = fs.readFileSync(inputPath);
  const candidate: unknown = JSON.parse(sourceBytes.toString("utf8"));
  const result = sanitizeLiveAwsEvidenceBundle(candidate, {
    sourceBytes,
    explicitRedactions: readRedactionFile(args.redactionFile)
  });
  writeAtomically(outputPath, `${JSON.stringify(result.bundle, null, 2)}\n`, args.force);
  console.log(
    JSON.stringify(
      {
        output: outputPath,
        validation: "PASS",
        redactedPathCount: result.redactedPaths.length,
        redactionLabels: result.redactionLabels
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  try {
    runSanitizerCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
