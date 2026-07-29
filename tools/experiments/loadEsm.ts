/**
 * Load a genuinely-ESM module from CommonJS experiment code.
 *
 * Why this is not just `await import(...)`:
 *
 *   - This repository compiles to CommonJS, so TypeScript/ts-node downlevels
 *     `await import(x)` into `require(x)`, which cannot accept a `file://` URL.
 *   - The usual escape hatch, `new Function("s", "return import(s)")`, throws
 *     "A dynamic import callback was not specified" under the Vitest module runner,
 *     so experiments that worked on the CLI failed in the test suite.
 *
 * `createRequire` gives a real Node.js require bound to this file, which bypasses the
 * test runner's transform pipeline entirely. That is exactly what the experiments need:
 * `verifiers/node/ghost_receipt_verify.mjs` must be loaded as the standalone ESM file it
 * ships as, with its built-ins-only import graph intact and untransformed. A transformed
 * copy would no longer be the artifact under measurement.
 *
 * Requires Node >= 22.12 for `require()` of ESM. The verifier has no top-level await,
 * so it is eligible.
 */

import { createRequire } from "node:module";

const nodeRequire = createRequire(__filename);

/**
 * Load an ESM module by absolute filesystem path (NOT a file:// URL).
 *
 * Node's `require(esm)` returns the module namespace object. When a module has a
 * default export, some Node versions surface it under `.default`, so callers that
 * expect named exports get the namespace unwrapped here only when the namespace is a
 * bare default wrapper.
 */
export function loadEsmModule<T>(absolutePath: string): T {
  const loaded = nodeRequire(absolutePath) as T & { default?: T };

  if (loaded && typeof loaded === "object" && "default" in loaded && Object.keys(loaded).length === 1) {
    return loaded.default as T;
  }

  return loaded;
}
