import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
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
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "cdk.out",
]);

const skippedFiles = new Set([
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const allowedPolicyFiles = new Set([
  "docs/research/THREAT_MODEL_FRONTIER.md",
  "docs/research/ASSURANCE_MATURITY_LADDER.md",
  "docs/research/AGENT_RESEARCH_AUDIT_2026-07-08.md",
  "docs/release/CLAIMS_BOUNDARY.md",
  "docs/compliance/non-claims.md",
  "docs/governance/claim-evidence-matrix.md",
  "docs/governance/risk-register.md",
  "docs/governance/external-reviewer-guide.md",
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
    id: "certified-ai-safety",
    pattern: rx(
      String.raw`\b(?:certified\s+ai\s+safety|ai\s+safety\s+certified|ai[- ]safety[- ]certified)\b`,
    ),
    reason: "Unsupported AI-safety certification claim.",
    suggestion:
      "Say Ghost-Ark is an AWS-runtime-validation candidate or certification-supporting evidence prototype.",
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
    id: "general-guarantee",
    pattern: /\bguarantee(?:s|d|ing)?\b/i,
    reason: "Generic guarantee language is too broad for assurance claims.",
    suggestion:
      "Use bounded language: records, checks, verifies a binding, provides evidence, or requires validation.",
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
    pattern: /\b(?:zero\s+risk|no\s+risk|eliminat(?:e|es|ed|ing)\s+all\s+risk|risk[- ]free)\b/i,
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
    pattern: rx(
      String.raw`\b(?:un`,
      "breakable",
      String.raw`|fully\s+secure|perfectly\s+secure|impossible\s+to\s+(?:forge|bypass|tamper)|tamper[- ]proof)\b`,
    ),
    reason: "Absolute security claim.",
    suggestion:
      "Say the implementation is experimental and must be reviewed against specific threat models.",
    allowance: "strict",
  },
  {
    id: "secure-by-default",
    pattern: /\bsecure\s+by\s+default\b/i,
    reason: "Overbroad default-security claim.",
    suggestion:
      "Name the specific fail-closed behavior, validation rule, or configured security default.",
    allowance: "strict",
  },
  {
    id: "production-ready",
    pattern: /\bproduction[- ]ready\b/i,
    reason: "Unsupported production-readiness claim.",
    suggestion:
      "Say AWS-runtime-validation candidate, reference implementation, or prototype unless production evidence is provided.",
    allowance: "research",
  },
  {
    id: "enterprise-grade",
    pattern: /\benterprise[- ]grade\b/i,
    reason: "Unsupported enterprise-grade claim.",
    suggestion:
      "Say reviewer-grade, reference implementation, or evidence prototype unless enterprise review evidence exists.",
    allowance: "research",
  },
  {
    id: "audit-complete",
    pattern: /\baudit\s+complete\b/i,
    reason: "Unsupported audit-completion claim.",
    suggestion:
      "Say audit-supporting evidence exists, or identify the specific audit scope and reviewer.",
    allowance: "strict",
  },
  {
    id: "formal-verification",
    pattern: /\bformally\s+verified\b/i,
    reason: "Unsupported formal-verification claim.",
    suggestion:
      "Say tested, checked by counterexample search, schema-validated, or planned for formal verification.",
    allowance: "research",
  },
  {
    id: "compliance-certification",
    pattern: rx(
      String.raw`\b(?:certif(?:y|ies|ied|ication|ications)|certified)\b.{0,40}\b(?:`,
      "compliance",
      String.raw`|regulatory|SOC\s*2|HIPAA|FedRAMP|ISO\s*42001|ISO\/IEC\s*42001|NIST)\b|\b(?:SOC\s*2|HIPAA)\s+`,
      "compliant",
      String.raw`\b|\b(?:FedRAMP|ISO\s*42001|ISO\/IEC\s*42001|NIST)\s+certified\b`,
    ),
    reason: "Unsupported compliance-certification claim.",
    suggestion:
      "Say Ghost-Ark may produce evidence artifacts; do not claim certification without external proof.",
    allowance: "strict",
  },
  {
    id: "one-click-compliance",
    pattern: /\bone[- ]click\s+compliance\b/i,
    reason: "Compliance automation overclaim.",
    suggestion:
      "Say Ghost-Ark can produce evidence artifacts for review, not automatic compliance.",
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
  return extname(normalizePath(path));
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
    "not a",
    "not an",
    "not proof",
    "not certified",
    "not production",
    "not production-ready",
    "not production ready",
    "not a guarantee",
    "does not guarantee",
    "should reject",
    "reject as",
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
      "not implemented",
      "placeholder",
      "experimental",
      "reference implementation",
      "candidate",
      "requires live",
      "requires aws",
      "requires external",
      "requires validation",
      "requires live nitro enclaves",
      "requiring live nitro enclaves",
      "release blocker",
      "not yet",
      "partial",
      "planned",
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
      rule.pattern.lastIndex = 0;
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
      console.error(
        `\nChecked ${files.length} scannable files. ${violations.length} forbidden claim violation(s) found.`,
      );
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
