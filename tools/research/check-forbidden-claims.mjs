import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const roots = ["README.md", "docs"];

const allowedPolicyFiles = new Set([
  "docs/research/THREAT_MODEL_FRONTIER.md",
  "docs/research/ASSURANCE_MATURITY_LADDER.md",
]);

const forbiddenPatterns = [
  /proves ai safety/i,
  /guarantees model safety/i,
  /eliminates all risk/i,
  /fully trustless/i,
  /unbreakable/i,
  /certifies regulatory compliance/i,
  /guarantees safe model behavior/i,
];

function collectMarkdownFiles(path) {
  const files = [];

  const stat = statSync(path);

  if (stat.isFile()) {
    if (path.endsWith(".md")) {
      files.push(path);
    }
    return files;
  }

  for (const entry of readdirSync(path)) {
    files.push(...collectMarkdownFiles(join(path, entry)));
  }

  return files;
}

const markdownFiles = roots.flatMap((root) => collectMarkdownFiles(root));

const failures = [];

for (const file of markdownFiles) {
  if (allowedPolicyFiles.has(file)) {
    continue;
  }

  const text = readFileSync(file, "utf8");

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      failures.push(`${file}: forbidden claim matched ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Forbidden assurance overclaims detected:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Checked ${markdownFiles.length} markdown files. No forbidden assurance overclaims detected.`);
