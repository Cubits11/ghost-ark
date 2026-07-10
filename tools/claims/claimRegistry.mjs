import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Structured claim registry — decidable overclaiming detection.
 *
 * See docs/research/CLAIM_ENTAILMENT_MODEL.md. The lexical scanner
 * (tools/research/check-forbidden-claims.mjs) enforces vocabulary; it cannot tell
 * whether a claim asserts more than its evidence supports. Sound natural-language
 * entailment (E ⊨ C over English prose) is undecidable in general, and an LLM
 * judge is unsound — the exact "trust the model" this project rejects.
 *
 * This checker makes the entailment question decidable by structuring it:
 *   - a claim asserts an assurance level L_c (a Truth-Ladder rung, 0..10);
 *   - each citation binds an artifact by path + expected sha256 and declares the
 *     level L_a that artifact supports;
 *   - the claim is admissible iff every citation's artifact EXISTS inside the
 *     reviewed tree, its bytes hash to the recorded digest (so you cannot
 *     cite-then-mutate), and L_c <= min(L_a over citations).
 *
 * "Does the evidence entail the claim?" is thereby reduced to an integer
 * comparison over cryptographically-bound artifacts — reproducible and resistant
 * to cite-then-mutate of a bound artifact. It is NOT resistant to a lying
 * registry author, who controls the assigned support levels; and it does NOT
 * establish semantic truth. It establishes only that a claim does not assert a
 * higher assurance rung than its bound evidence.
 */

export const CLAIM_REGISTRY_SCHEMA_VERSION = "ghost.claim_registry.v1";
const MAX_LEVEL = 10;

export function computeArtifactDigest(absolutePath) {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

export function checkClaim(claim, rootDir = process.cwd()) {
  const reasons = [];

  // Fail closed on a non-object claim rather than dereferencing null/undefined.
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    return { id: "(unnamed)", ok: false, asserts_level: null, supported_level: -1, reasons: ["claim must be a JSON object"] };
  }

  const rootResolved = resolve(rootDir);

  if (typeof claim.id !== "string" || claim.id.length === 0) {
    reasons.push("claim.id must be a non-empty string");
  }
  if (typeof claim.statement !== "string" || claim.statement.length === 0) {
    reasons.push("claim.statement must be a non-empty string");
  }
  if (!Number.isInteger(claim.asserts_level) || claim.asserts_level < 0 || claim.asserts_level > MAX_LEVEL) {
    reasons.push(`claim.asserts_level must be an integer in 0..${MAX_LEVEL}`);
  }
  if (!Array.isArray(claim.cites) || claim.cites.length === 0) {
    reasons.push("claim.cites must list at least one artifact");
  }

  let supported = Number.POSITIVE_INFINITY;
  for (const cite of Array.isArray(claim.cites) ? claim.cites : []) {
    if (!cite || typeof cite.path !== "string") {
      reasons.push("each citation requires a path");
      supported = -1;
      continue;
    }
    const absolute = resolve(rootResolved, cite.path);
    // Containment: a citation must resolve inside the reviewed tree. Absolute
    // paths and '../' escapes make admissibility machine-dependent and break the
    // reproducibility the model rests on.
    if (absolute !== rootResolved && !absolute.startsWith(rootResolved + sep)) {
      reasons.push(`cited artifact escapes the reviewed tree: ${cite.path}`);
      supported = -1;
      continue;
    }
    if (!existsSync(absolute)) {
      reasons.push(`cited artifact does not exist: ${cite.path}`);
      supported = -1;
      continue;
    }
    if (lstatSync(absolute).isSymbolicLink()) {
      reasons.push(`cited artifact is a symlink (may escape the tree): ${cite.path}`);
      supported = -1;
      continue;
    }
    if (!statSync(absolute).isFile()) {
      reasons.push(`cited artifact is not a regular file: ${cite.path}`);
      supported = -1;
      continue;
    }
    if (typeof cite.expect_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(cite.expect_sha256)) {
      reasons.push(`citation ${cite.path} requires a lowercase sha256 expect_sha256`);
      supported = -1;
      continue;
    }
    const actual = computeArtifactDigest(absolute);
    if (actual !== cite.expect_sha256) {
      reasons.push(`digest mismatch for ${cite.path}: expected ${cite.expect_sha256}, got ${actual}`);
      supported = -1;
      continue;
    }
    if (!Number.isInteger(cite.supports_level) || cite.supports_level < 0 || cite.supports_level > MAX_LEVEL) {
      reasons.push(`citation ${cite.path} requires an integer supports_level in 0..${MAX_LEVEL}`);
      supported = -1;
      continue;
    }
    supported = Math.min(supported, cite.supports_level);
  }

  if (supported === Number.POSITIVE_INFINITY) {
    supported = -1;
  }

  if (supported >= 0 && Number.isInteger(claim.asserts_level) && claim.asserts_level > supported) {
    reasons.push(
      `overclaim: asserts assurance level ${claim.asserts_level} but bound evidence supports only ${supported}`,
    );
  }

  return {
    id: typeof claim.id === "string" ? claim.id : "(unnamed)",
    ok: reasons.length === 0,
    asserts_level: typeof claim.asserts_level === "number" ? claim.asserts_level : null,
    supported_level: supported,
    reasons,
  };
}

export function checkRegistry(registry, rootDir = process.cwd()) {
  if (!registry || registry.schema_version !== CLAIM_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported claim registry schema_version: ${registry?.schema_version}`);
  }
  if (!Array.isArray(registry.claims)) {
    throw new Error("Claim registry requires a claims array");
  }
  return registry.claims.map((claim) => checkClaim(claim, rootDir));
}

export function main(argv = process.argv.slice(2)) {
  const registryPath = argv[0];
  if (!registryPath) {
    console.error("usage: node tools/claims/claimRegistry.mjs <registry.json> [rootDir]");
    return 2;
  }
  const rootDir = resolve(argv[1] ?? process.cwd());
  let registry;
  try {
    registry = JSON.parse(readFileSync(resolve(registryPath), "utf8"));
  } catch (error) {
    console.error(`Failed to read claim registry: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let results;
  try {
    results = checkRegistry(registry, rootDir);
  } catch (error) {
    console.error(`Claim registry check failed closed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    const status = result.ok ? "OK  " : "FAIL";
    console.log(`${status} ${result.id} (asserts ${result.asserts_level}, supported ${result.supported_level})`);
    for (const reason of result.reasons) {
      console.log(`     - ${reason}`);
    }
  }
  console.log(`\nChecked ${results.length} claim(s). ${failed.length} inadmissible.`);
  return failed.length > 0 ? 1 : 0;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  process.exitCode = main();
}
