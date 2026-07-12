import { readdirSync, readFileSync, lstatSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Machine-checked assumption lattice (Phase III/IV enforcement).
 *
 * Modules may declare `export const MATURITY` and `export const ASSUMPTIONS`.
 * This tool builds the import graph among annotated modules, propagates
 * assumptions transitively, and enforces:
 *
 *   Assurance(module) <= min(
 *     statusCap(a)   for a in transitive assumptions,
 *     maturity(dep)  for dep in transitive annotated dependencies
 *   )
 *
 * A module whose DECLARED MATURITY exceeds that bound is a violation, as is a
 * reference to an assumption absent from the registry. Naming implies nothing;
 * this is the executable form of the maturity separation.
 */

export const MATURITY_ORDER = ["SYNTH_ONLY", "RESEARCH", "PRODUCTION"];
export const STATUS_ORDER = ["UNMET", "PARTIAL", "HELD"];

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "cdk.out", "coverage", "build"]);

function maturityRank(m) {
  return MATURITY_ORDER.indexOf(m);
}
// A status of rank r caps assurance at the maturity of rank r (identity map:
// UNMET->SYNTH_ONLY, PARTIAL->RESEARCH, HELD->PRODUCTION).
function statusCapRank(status) {
  return STATUS_ORDER.indexOf(status);
}

export function loadRegistry(registryPath) {
  const raw = JSON.parse(readFileSync(registryPath, "utf8"));
  if (raw.schema_version !== "ghostark.assumptions.registry.v1") {
    throw new Error(`Unsupported assumption registry schema ${raw.schema_version}`);
  }
  return raw;
}

const MATURITY_RE = /export\s+const\s+MATURITY\b[^=]*=\s*["'](PRODUCTION|RESEARCH|SYNTH_ONLY)["']/;
const ASSUMPTIONS_RE = /export\s+const\s+ASSUMPTIONS\b[^=]*=\s*\[([\s\S]*?)\]/;
const IMPORT_RE = /(?:import|export)\s+[^;]*?from\s*["']([^"']+)["']/g;

/** Parse one source file into a module descriptor, or null if not annotated. */
export function parseModule(absPath, text) {
  const maturityMatch = MATURITY_RE.exec(text);
  if (maturityMatch === null) {
    return null;
  }
  const assumptions = [];
  const assumptionsBlock = ASSUMPTIONS_RE.exec(text);
  if (assumptionsBlock !== null) {
    for (const m of assumptionsBlock[1].matchAll(/["']([A-Z0-9_]+)["']/g)) {
      assumptions.push(m[1]);
    }
  }
  const imports = [];
  IMPORT_RE.lastIndex = 0;
  for (const m of text.matchAll(IMPORT_RE)) {
    if (m[1].startsWith(".")) {
      imports.push(m[1]);
    }
  }
  return { absPath, maturity: maturityMatch[1], assumptions, imports };
}

/** Resolve a relative import specifier from `fromAbs` to a candidate module key. */
function resolveImport(fromAbs, specifier, moduleKeys) {
  const base = resolve(dirname(fromAbs), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (moduleKeys.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Walk `roots`, returning annotated module descriptors keyed by absolute path. */
export function scanModules(roots) {
  const modules = new Map();
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      const name = path.split(/[/\\]/).pop();
      if (SKIP_DIRS.has(name)) {
        return;
      }
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }
    if (!path.endsWith(".ts") || path.endsWith(".d.ts") || path.endsWith(".test.ts")) {
      return;
    }
    const parsed = parseModule(path, readFileSync(path, "utf8"));
    if (parsed !== null) {
      modules.set(path, parsed);
    }
  };
  for (const root of roots) {
    if (existsSync(root)) {
      visit(resolve(root));
    }
  }
  return modules;
}

/**
 * Analyze annotated modules against the registry. Pure function over an array of
 * descriptors (each { absPath, maturity, assumptions, imports }); returns
 * per-module effective caps plus a flat violation list. Filesystem-free so it is
 * directly unit-testable with synthetic module graphs.
 */
export function analyze(moduleList, registry) {
  const keys = new Set(moduleList.map((m) => m.absPath));
  const byKey = new Map(moduleList.map((m) => [m.absPath, m]));

  // Resolve edges to other annotated modules.
  const edges = new Map();
  for (const mod of moduleList) {
    const resolved = [];
    for (const specifier of mod.imports) {
      const target = resolveImport(mod.absPath, specifier, keys);
      if (target !== null) {
        resolved.push(target);
      }
    }
    edges.set(mod.absPath, resolved);
  }

  const violations = [];
  const results = [];

  for (const mod of moduleList) {
    // BFS the transitive closure of annotated dependencies.
    const reached = new Set();
    const queue = [...(edges.get(mod.absPath) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift();
      if (reached.has(next)) {
        continue;
      }
      reached.add(next);
      queue.push(...(edges.get(next) ?? []));
    }

    // Fold assumptions from self + all reachable annotated modules.
    const transitiveAssumptions = new Set(mod.assumptions);
    for (const depKey of reached) {
      for (const a of byKey.get(depKey).assumptions) {
        transitiveAssumptions.add(a);
      }
    }

    let assumptionCap = maturityRank("PRODUCTION");
    for (const a of transitiveAssumptions) {
      const entry = registry.assumptions[a];
      if (entry === undefined) {
        violations.push({ module: mod.absPath, kind: "unknown_assumption", detail: `Assumption ${a} is not in the registry.` });
        assumptionCap = 0;
        continue;
      }
      assumptionCap = Math.min(assumptionCap, statusCapRank(entry.status));
    }

    // A module may not claim more maturity than any annotated dependency.
    let depCap = maturityRank("PRODUCTION");
    for (const depKey of reached) {
      depCap = Math.min(depCap, maturityRank(byKey.get(depKey).maturity));
    }

    const effectiveCap = Math.min(assumptionCap, depCap);
    const declaredRank = maturityRank(mod.maturity);
    const ok = declaredRank <= effectiveCap;
    if (!ok) {
      violations.push({
        module: mod.absPath,
        kind: "maturity_overclaim",
        detail: `Declares ${mod.maturity} but transitive assumptions/dependencies cap it at ${MATURITY_ORDER[effectiveCap] ?? "SYNTH_ONLY"}.`,
      });
    }
    results.push({
      module: mod.absPath,
      declared: mod.maturity,
      effectiveCap: MATURITY_ORDER[effectiveCap] ?? "SYNTH_ONLY",
      transitiveAssumptions: [...transitiveAssumptions].sort(),
      ok,
    });
  }

  return { results, violations };
}

export function main(argv = process.argv.slice(2)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const registryPath = argv[0] ? resolve(argv[0]) : join(here, "registry.json");

  try {
    const registry = loadRegistry(registryPath);
    const roots = ["packages", "services", "apps", "infra", "tools"].map((r) => join(repoRoot, r));
    const modules = [...scanModules(roots).values()];
    const { results, violations } = analyze(modules, registry);

    for (const r of results) {
      const rel = relative(repoRoot, r.module);
      console.log(`${r.ok ? "ok  " : "FAIL"} ${r.declared.padEnd(11)} (cap ${r.effectiveCap.padEnd(11)}) ${rel}`);
    }

    if (violations.length > 0) {
      console.error("\nAssumption lattice violations:");
      for (const v of violations) {
        console.error(`- [${v.kind}] ${relative(repoRoot, v.module)}: ${v.detail}`);
      }
      console.error(`\n${modules.length} annotated module(s). ${violations.length} violation(s).`);
      return 1;
    }

    console.log(`\n${modules.length} annotated module(s). No assumption lattice violations.`);
    return 0;
  } catch (error) {
    console.error(`Assumption check failed closed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  process.exitCode = main();
}
