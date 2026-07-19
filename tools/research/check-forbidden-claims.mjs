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
  // Manuscript sources are public claim text and must pass the same gate.
  ".tex",
  ".bib",
  // Build orchestration and shell entrypoints are reviewer-facing claim text.
  // Before these were added, Makefile echo banners ("REVIEW STATUS: ...") and
  // script narration sat entirely outside the gate.
  ".sh",
  ".mk",
]);

// Extensionless build files are matched by basename, not extension, so a
// rename (Makefile -> makefile/GNUmakefile) cannot exit the gate.
const scannableBasenames = new Set(["Makefile", "makefile", "GNUmakefile"]);

function isScannableName(name) {
  // Dockerfiles ("Dockerfile", "Dockerfile.reviewer") carry reviewer-facing
  // comment text and have no stable extension.
  return (
    scannableBasenames.has(name) ||
    name === "Dockerfile" ||
    name.startsWith("Dockerfile.")
  );
}

const skippedDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "cdk.out",
  // Rust build output (dab/*/target) — compiled artifacts and cargo
  // fingerprint JSON are not public claim text.
  "target",
  // Generated run outputs (TLC logs, bench JSON, stage status). Authored claim
  // text is gated at its source; scanning generated logs would make the gate's
  // verdict depend on local run state instead of the committed tree.
  "artifacts",
  ".cache",
]);

const skippedFiles = new Set([
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const allowedPolicyFiles = new Set([
  // The scanner itself contains forbidden phrases as rule IDs, regexes,
  // reasons, and suggestions. It must not scan itself as public claim text.
  "tools/research/check-forbidden-claims.mjs",

  // Tests intentionally contain forbidden phrases to verify rejection behavior.
  "tests/unit/research-frontier/checkForbiddenClaims.test.ts",
  "tests/unit/research-frontier/claimScannerHardening.test.ts",

  // Claims-enforcement source: encodes the forbidden fragments it rejects at
  // runtime, so its rule constants are not public claims.
  "packages/research-frontier/src/frontierClaims.ts",

  // Policy and boundary documents are allowed to quote unsafe wording because
  // their purpose is to define rejected claims, limitations, and evidence gaps.
  "CLAUDE.md",
  "docs/research/THREAT_MODEL_FRONTIER.md",
  "docs/research/ASSURANCE_MATURITY_LADDER.md",
  "docs/research/AGENT_RESEARCH_AUDIT_2026-07-08.md",
  // Boundary docs: define the non-claim vocabulary and quote forbidden wording as
  // examples of what NOT to say, so their forbidden fragments are policy, not claims.
  "docs/research/AUDITABILITY_SAFETY_SEPARATION.md",
  "docs/research/NON_CLAIM_ENGINEERING.md",
  // Dated adversarial audit snapshots: quote guarantee-language to critique it
  // ("PROOF OBLIGATION ... not present"), so their fragments are analysis, not claims.
  "docs/validation/ADVERSARIAL_CHECKLIST_AUDIT_2026-07-11.md",
  "docs/validation/PHD_DEFENCE_AUDIT_2026-07-11.md",
  "docs/release/CLAIMS_BOUNDARY.md",
  "docs/compliance/non-claims.md",
  "docs/architecture/CLAIM_BOUNDARIES.md",
  "docs/research/CLAIM_EVIDENCE_MATRIX.md",
  "docs/research/FORMAL_METHODS_NOTES.md",
  "docs/research/RECEIPT_TRUTH_LADDER.md",
  "docs/research/RESEARCH_FRONTIER_ROADMAP.md",
  "docs/security/RECEIPT_ATTACK_CORPUS.md",
  "docs/security/SECURITY_REVIEW_BACKLOG.md",
  "docs/validation/ADVERSARIAL_RUNTIME_EVIDENCE_INDEX.md",
  "docs/validation/RECEIPT_VERIFIER_LIVE_PASS_2026-07-07.md",
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
    id: "enterprise-ready",
    pattern: /\benterprise[- ]ready\b/i,
    reason: "Unsupported enterprise-readiness claim.",
    suggestion:
      "Say reference implementation or evidence prototype unless enterprise review evidence exists.",
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
      String.raw`\b|\b(?:FedRAMP|ISO\s*42001|ISO\/IEC\s*42001|NIST)\s+certified\b|\b`,
      "compliance",
      String.raw`[- ]certified\b`,
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
  // --- Pseudo-physics / fabricated-empiricism family (2026-07 audit) --------
  // These trap the vocabulary that dressed unimplemented or in-memory code as
  // kernel/hardware/physics fact (Makefile "bare-metal physics", benchmark
  // "[PHYSICS CHECK]" narration, "Holographic RAM"). Regex cannot detect a
  // fabricated number as such; it can trap the phrasing that presents
  // narration as measurement.
  {
    id: "pseudo-physics",
    pattern: rx(
      String.raw`\bholographic\s+(?:ram|memory|space|isolations?)\b`,
      String.raw`|\bquantum\s+spooks?\b`,
      String.raw`|\bbare[- ]metal\s+physics\b`,
    ),
    reason: "Pseudo-physics vocabulary presented as a systems property.",
    suggestion:
      "Name the concrete mechanism and its recorded evidence (test, artifact path, or spec); physics vocabulary is not evidence.",
    allowance: "strict",
  },
  {
    id: "fabricated-empiricism",
    pattern: rx(
      String.raw`\bhardware[- ]bounded\b`,
      String.raw`|\bphysics[- ]checks?\b`,
      String.raw`|\bderived\s+from\s+bare[- ]metal\b`,
    ),
    reason: "Presents narration as hardware-derived measurement.",
    suggestion:
      "Cite the recorded measurement artifact (a path under artifacts/) and the command that produced it, or drop the hardware framing.",
    allowance: "research",
  },
  {
    id: "thermodynamic-safety-claim",
    pattern: /\bthermodynamic(?:s|ally)?\b/i,
    reason:
      "Thermodynamic framing of guardrail or governance behavior without measured-evidence context.",
    suggestion:
      "State the measured compute or energy quantity and its recorded artifact, or remove the thermodynamic framing.",
    allowance: "research",
  },
  {
    id: "absolute-review-status",
    pattern: rx(
      String.raw`\bimmutably\s+sound\b`,
      String.raw`|\bperfectly\s+capable\b`,
      String.raw`|\bunconditionally\s+(?:neutraliz|prevent|block|secur)`,
    ),
    reason: "Absolute status banner or unconditional-defense assertion.",
    suggestion:
      "Report per-stage status from recorded artifacts (artifacts/reports/aec_summary.json); avoid absolute soundness banners.",
    allowance: "strict",
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
    "forbidden wording",
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
    "rejected claim",
    "rejected wording",
    "invalid claim",
    "unsafe claim",
    "unsafe wording",
    "disallowed claim",
    "disallowed wording",
    "overclaim",
    "overclaims",
    "overclaiming",
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

function isAllowedText(text, allowance) {
  if (allowance === "research") {
    return hasResearchAllowanceContext(text);
  }
  return hasStrictNonClaimContext(text);
}

function formatViolation(violation) {
  return [
    `${violation.filePath}:${violation.lineNumber} [${violation.ruleId}] ${violation.reason}`,
    `  line: ${violation.line}`,
    `  suggestion: ${violation.suggestion}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// E2/E3 hardening: normalize before matching, match across line breaks, and
// scope the non-claim allowance to the clause containing the phrase.
//
// Rationale (exploits this closes):
//   E2 — Unicode/confusable: a raw code-point regex is bypassed by homoglyphs
//        ("gυаrantee"), zero-width splits ("guar​antee"), fullwidth forms,
//        and NBSP separators. Matching now runs over a normalized form.
//   E3 — line-split: a phrase broken by a newline evaded per-line matching.
//        Matching now runs over the whole document with newlines folded.
//   E3 — allowance smuggling: the old check allowed a line if it merely CONTAINED
//        a marker like "is not"/"candidate", so "This is not a toy: Ghost-Ark is
//        production-ready and guarantees safety" passed. Allowance is now scoped
//        to the clause holding the phrase, so a disclaimer in a different clause
//        no longer excuses a claim.
//
// NON-CLAIM: the confusable map is a curated, bounded subset of UTS #39 (the
// Cyrillic/Greek Latin-lookalikes that NFKC does not fold), not the full
// confusable skeleton. It reduces, but does not eliminate, homoglyph evasion.
// ---------------------------------------------------------------------------

// Zero-width / default-ignorable characters used purely to split tokens.
const invisiblePattern =
  /[­​‌‍‎‏⁠⁡⁢⁣⁤⁦⁧⁨⁩‪‫‬‭‮﻿᠎]/;

// Curated confusable homoglyph -> ASCII Latin. NFKC already folds fullwidth,
// ligature, and compatibility forms, so this only needs the script-mixing
// lookalikes (Cyrillic and a few Greek) that NFKC leaves intact.
const confusables = new Map(
  Object.entries({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
    "у": "y", "х": "x", "к": "k", "м": "m", "н": "h",
    "т": "t", "в": "b", "і": "i", "ј": "j", "ѕ": "s",
    "ё": "e",
    "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C",
    "У": "Y", "Х": "X", "К": "K", "М": "M", "Н": "H",
    "Т": "T", "В": "B", "І": "I", "Ј": "J", "Ѕ": "S",
    "α": "a", "ο": "o", "ρ": "p", "ν": "v", "ϲ": "c",
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H",
    "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O",
    "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  }),
);

function foldChar(ch) {
  const mapped = confusables.get(ch);
  return mapped !== undefined ? mapped : ch;
}

/**
 * Normalize raw text into a matching form robust to confusables, invisible
 * characters, and line-break evasion, while retaining a per-character source
 * line map so violations still report the line where the phrase begins.
 */
export function normalizeForMatch(rawText) {
  const out = [];
  const lineFor = [];
  let line = 1;
  let lastWasSpace = false;

  const pushChar = (ch, srcLine) => {
    out.push(ch);
    lineFor.push(srcLine);
    lastWasSpace = ch === " ";
  };
  const pushSpace = (srcLine) => {
    if (lastWasSpace || out.length === 0) {
      return;
    }
    pushChar(" ", srcLine);
  };

  for (const raw of rawText) {
    if (raw === "\n") {
      // End-of-line hyphenation ("production-\nready"): keep the hyphen glued
      // to the next line by NOT inserting a space; otherwise fold to a space.
      if (!(out.length > 0 && out[out.length - 1] === "-")) {
        pushSpace(line);
      }
      line += 1;
      continue;
    }
    if (raw === "\r" || invisiblePattern.test(raw)) {
      continue;
    }
    const code = raw.codePointAt(0) ?? 0;
    const projected = code < 128 ? raw : foldChar(raw).normalize("NFKC");
    for (const ch of projected) {
      if (/\s/.test(ch)) {
        pushSpace(line);
      } else {
        pushChar(foldChar(ch), line);
      }
    }
  }

  return { text: out.join(""), lineFor };
}

// Clause boundaries: a disclaimer before one of these does not govern a claim
// after it. Global so matchAll can enumerate every boundary.
const boundaryPattern =
  /:|;|—|--|\.\s|\?\s|!\s|\sbut\s|\showever\s|\syet\s|\salthough\s|\sand\s/gi;

function clauseStartBefore(text, index) {
  const slice = text.slice(0, index);
  const matches = [...slice.matchAll(boundaryPattern)];
  if (matches.length === 0) {
    return 0;
  }
  const last = matches[matches.length - 1];
  return (last.index ?? 0) + last[0].length;
}

function clauseEndAfter(text, index) {
  const slice = text.slice(index);
  const next = [...slice.matchAll(boundaryPattern)][0];
  return next === undefined ? text.length : index + (next.index ?? 0);
}

export function scanText(rawText, filePath) {
  const violations = [];
  const { text, lineFor } = normalizeForMatch(rawText);
  const rawLines = rawText.split(/\r?\n/);
  const seen = new Set();

  for (const rule of rules) {
    const flags = rule.pattern.flags.includes("g")
      ? rule.pattern.flags
      : `${rule.pattern.flags}g`;
    const globalPattern = new RegExp(rule.pattern.source, flags);
    for (const match of text.matchAll(globalPattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const lineNumber = lineFor[start] ?? 1;
      // Structural allowance: only the clause holding the phrase — the text
      // between the nearest boundaries on both sides — can excuse it. A
      // disclaimer in a different clause does not.
      const region = text.slice(clauseStartBefore(text, start), clauseEndAfter(text, end));
      if (isAllowedText(region, rule.allowance)) {
        continue;
      }
      const key = `${rule.id}:${lineNumber}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      violations.push({
        filePath,
        lineNumber,
        line: (rawLines[lineNumber - 1] ?? "").trim(),
        ruleId: rule.id,
        reason: rule.reason,
        suggestion: rule.suggestion,
      });
    }
  }

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

    if (scannableExtensions.has(extensionOf(path)) || isScannableName(name)) {
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
