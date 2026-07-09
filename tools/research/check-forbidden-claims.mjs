import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scannableExtensions = new Set([
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".json",
  ".yml",
  ".yaml",
]);

const skippedDirectories = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const skippedFiles = new Set([
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

// Exact policy-document exceptions. These files catalogue claim boundaries and
// known forbidden phrasing, so they are allowed to quote unsafe language.
const allowedPolicyFiles = new Set([
  "docs/research/THREAT_MODEL_FRONTIER.md",
  "docs/research/ASSURANCE_MATURITY_LADDER.md",
  "docs/research/AGENT_RESEARCH_AUDIT_2026-07-08.md",
  "docs/release/CLAIMS_BOUNDARY.md",
]);

const boundarySuggestion =
  "Say: Given receipt R, policy hash H, signature S, key manifest K, and checkpoint C, an external verifier can check the recorded binding under Ghost-Ark verifier rules.";

function rx(...parts) {
  return new RegExp(parts.join(""), "i");
}

const rules = [
  {
    id: "ai-safety-proof",
    pattern: /\bprov(?:e|es|ed|ing)\s+ai\s+safety\b/i,
    reason: "Broad AI-safety proof claim.",
    suggestion: boundarySuggestion,
    allowance: "strict",
  },
  {
    id: "model-safety-guarantee",
    pattern: /\b(?:guarantee(?:s|d)?|guaranteeing)\s+(?:safe\s+model\s+behavior|model\s+safety)\b/i,
    reason: "Broad model-safety guarantee.",
    suggestion:
      "Say Ghost-Ark records policy decisions and verifier inputs; do not claim model behavior is safe.",
    allowance: "strict",
  },
  {
    id: "alignment-guarantee",
    pattern: /\b(?:guarantee(?:s|d)?|guaranteeing)\s+alignment\b/i,
    reason: "Broad alignment guarantee.",
    suggestion:
      "Say Ghost-Ark can bind a receipt to declared policy context; do not claim alignment guarantees.",
    allowance: "strict",
  },
  {
    id: "truthfulness-guarantee",
    pattern: /\b(?:(?:guarantee(?:s|d)?|guaranteeing|prov(?:e|es|ed|ing))\s+(?:truthfulness|semantic\s+correctness)|truthfulness\s+guarantee)\b/i,
    reason: "Semantic-truth assurance claim.",
    suggestion:
      "Say Ghost-Ark can verify recorded bindings, not the truth of model outputs.",
    allowance: "strict",
  },
  {
    id: "risk-elimination",
    pattern: /\beliminat(?:e|es|ed|ing)\s+all\s+risk\b/i,
    reason: "Absolute risk-elimination claim.",
    suggestion:
      "Say Ghost-Ark narrows what can be checked from recorded artifacts; residual risk remains.",
    allowance: "strict",
  },
  {
    id: "fully-trustless",
    pattern: /\bfully\s+trustless\b/i,
    reason: "Unsupported trustlessness claim.",
    suggestion:
      "Say Ghost-Ark reduces selected trust assumptions and makes recorded bindings externally checkable.",
    allowance: "strict",
  },
  {
    id: "absolute-security",
    pattern: rx(String.raw`\bun`, "breakable", String.raw`\b`),
    reason: "Absolute security claim.",
    suggestion:
      "Say the implementation is experimental and must be reviewed against specific threat models.",
    allowance: "strict",
  },
  {
    id: "production-enterprise",
    pattern: /\bproduction[- ]ready\s+enterprise\s+infrastructure\b/i,
    reason: "Unsupported production-readiness claim.",
    suggestion:
      "Say this is a reference implementation unless deployment evidence and review scope are included.",
    allowance: "research",
  },
  {
    id: "compliance-certification",
    pattern: rx(
      String.raw`\b(?:certif(?:y|ies|ied|ication|ications)|certified)\b.{0,40}\b(?:`,
      "compliance",
      String.raw`|regulatory|SOC\s*2|HIPAA|FedRAMP|ISO\s*42001|NIST)\b|\b(?:SOC\s*2|HIPAA)\s+`,
      "compliant",
      String.raw`\b|\b(?:FedRAMP|ISO\s*42001|NIST)\s+certified\b`,
    ),
    reason: "Unsupported compliance-certification claim.",
    suggestion:
      "Say Ghost-Ark may produce evidence artifacts; do not claim certification without external proof.",
    allowance: "strict",
  },
  {
    id: "zk-execution-claim",
    pattern: rx(
      String.raw`\b(?:executes?|runs?|verif(?:y|ies|ied)|real|live)\b.{0,40}\b(?:`,
      "zk",
      String.raw`|zero-knowledge|zkvm|STARK|SNARK)\b.{0,40}\b(?:`,
      "proofs?",
      String.raw`|verification|execution)\b|\b(?:STARK|SNARK)\s+execution\b`,
    ),
    reason: "Unsupported zk execution claim.",
    suggestion:
      "Say zk-related artifacts are mock, schema-only, future work, or include real prover/verifier evidence.",
    allowance: "research",
  },
  {
    id: "hardware-enforced-isolation",
    pattern: /\bhardware[- ]enforced\s+isolation\b/i,
    reason: "Hardware isolation claim without live Nitro qualification.",
    suggestion:
      "Say hardware-enforced isolation requires live Nitro Enclaves deployment and attestation evidence.",
    allowance: "research",
  },
];

function normalizePath(path) {
  return path.split(/[/\\]+/).join("/");
}

function extensionOf(path) {
  const normalized = normalizePath(path);
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot === -1) {
    return "";
  }
  return normalized.slice(lastDot);
}

function hasStrictNonClaimContext(line) {
  const normalized = line.toLowerCase();
  return [
    "does not",
    "do not",
    "must not",
    "never claim",
    "no unsupported",
    "non-claim",
    "non claim",
    "forbidden",
    "not claim",
    "without claiming",
    "cannot claim",
    "is not",
    "are not",
  ].some((marker) => normalized.includes(marker));
}

function hasResearchAllowanceContext(line) {
  const normalized = line.toLowerCase();
  return (
    hasStrictNonClaimContext(line) ||
    [
      "future research",
      "future work",
      "schema-only",
      "schema only",
      "mock",
      "simulation",
      "simulated",
      "not production-ready",
      "not production ready",
      "not implemented",
      "placeholder",
      "experimental",
      "requires live nitro enclaves",
      "requiring live nitro enclaves",
    ].some((marker) => normalized.includes(marker))
  );
}

function isAllowedLine(line, allowance) {
  if (allowance === "research") {
    return hasResearchAllowanceContext(line);
  }
  return hasStrictNonClaimContext(line);
}

function formatViolation(violation) {
  return [
    `${violation.filePath}:${violation.lineNumber} [${violation.ruleId}] ${violation.reason}`,
    `  line: ${violation.line}`,
    `  suggestion: ${violation.suggestion}`,
  ].join("\n");
}

export function scanText(text, filePath) {
  const violations = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(line) && !isAllowedLine(line, rule.allowance)) {
        violations.push({
          filePath,
          lineNumber: index + 1,
          line,
          ruleId: rule.id,
          reason: rule.reason,
          suggestion: rule.suggestion,
        });
      }
    }
  });

  return violations;
}

export function scanFile(filePath, rootDir = process.cwd()) {
  const text = readFileSync(filePath, "utf8");
  const relativePath = normalizePath(relative(resolve(rootDir), resolve(filePath)));
  if (allowedPolicyFiles.has(relativePath)) {
    return [];
  }
  return scanText(text, relativePath);
}

export function collectScannableFiles(rootDir) {
  const root = resolve(rootDir);
  const files = [];

  function visit(path) {
    const stat = lstatSync(path);
    const name = basename(path);

    if (stat.isSymbolicLink()) {
      return;
    }

    if (stat.isDirectory()) {
      if (skippedDirectories.has(name)) {
        return;
      }
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }

    if (!stat.isFile() || skippedFiles.has(name)) {
      return;
    }

    if (scannableExtensions.has(extensionOf(path))) {
      files.push(path);
    }
  }

  visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

export function main(argv = process.argv.slice(2)) {
  const rootDir = resolve(argv[0] ?? process.cwd());

  try {
    const files = collectScannableFiles(rootDir);
    const violations = files.flatMap((file) => scanFile(file, rootDir));

    if (violations.length > 0) {
      console.error("Forbidden assurance overclaims detected:");
      for (const violation of violations) {
        console.error(`- ${formatViolation(violation)}`);
      }
      return 1;
    }

    console.log(
      `Checked ${files.length} scannable files. No forbidden assurance overclaims detected.`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Forbidden claim scan failed closed: ${message}`);
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  process.exitCode = main();
}
