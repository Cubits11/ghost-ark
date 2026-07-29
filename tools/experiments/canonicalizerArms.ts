/**
 * E1 implementation arms — four independent `parse -> canonicalize -> digest`
 * pipelines applied to the same raw JSON text.
 *
 * Independence matters: if all four arms shared a parser or a serializer, an
 * agreement result would be an artifact of the shared component rather than
 * evidence about canonicalization. The arms below differ as follows:
 *
 *   ghost-ark-receipt-schema      V8 JSON.parse + packages/receipt-schema canonicalize
 *   ghost-ark-independent-verifier V8 JSON.parse + verifiers/node canonicalize (built-ins only,
 *                                  written to import no Ghost-Ark package)
 *   naive-sorted-stringify         V8 JSON.parse + homebrew sort-keys JSON.stringify, included as
 *                                  the "what a reasonable engineer writes in ten minutes" control
 *   python-json-sorted             CPython json.loads + json.dumps(sort_keys=True), a genuinely
 *                                  separate parser and number formatter in a separate runtime
 *
 * Only the fourth arm has an independent PARSER. That asymmetry is itself a
 * finding and is reported, not hidden: collapses shared by the first three arms
 * may be V8-parser artifacts rather than canonicalizer choices.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadEsmModule } from "./loadEsm";
import { canonicalize as receiptSchemaCanonicalize } from "../../packages/receipt-schema/src/hashCanonicalization";
import { parseStrictJson } from "../../packages/receipt-schema/src/strictJsonAdmission";

/** Outcome of running one arm on one raw input. */
export type ArmOutcome =
  | { status: "digest"; digest: string; canonicalForm: string }
  | { status: "rejected"; reason: string };

export interface CanonicalizerArm {
  id: string;
  /** True when this arm's JSON parser is not V8's. */
  independentParser: boolean;
  description: string;
  run: (rawJson: string) => ArmOutcome;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function rejected(reason: string): ArmOutcome {
  return { status: "rejected", reason };
}

function digestOf(canonicalForm: string): ArmOutcome {
  return { status: "digest", digest: sha256Hex(canonicalForm), canonicalForm };
}

/** Homebrew sort-keys serializer: the control arm. Intentionally naive. */
function naiveSortedStringify(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => naiveSortedStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${naiveSortedStringify(entryValue)}`).join(",")}}`;
  }
  throw new Error(`naiveSortedStringify: unsupported value of type ${typeof value}`);
}

/**
 * Lazily-resolved availability of the Python arm. Absent Python is reported as an
 * explicit skip in the E1 report rather than silently dropping the arm, because a
 * quietly-missing arm would inflate cross-implementation agreement.
 */
let pythonProbe: { available: boolean; detail: string } | null = null;

export function probePython(): { available: boolean; detail: string } {
  if (pythonProbe) {
    return pythonProbe;
  }
  try {
    const version = execFileSync("python3", ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
    pythonProbe = { available: true, detail: version };
  } catch (error) {
    pythonProbe = { available: false, detail: error instanceof Error ? error.message : String(error) };
  }
  return pythonProbe;
}

/**
 * The Python arm. One subprocess per input keeps the arm honest (no shared state
 * with the Node arms) at the cost of speed; E1's census is 12 pairs, so the cost
 * is irrelevant. The randomized arm batches instead — see runPythonBatch.
 */
const PYTHON_PROGRAM = [
  "import json,sys,hashlib",
  "raw=sys.stdin.read()",
  "try:",
  "    v=json.loads(raw)",
  "except Exception as e:",
  "    print(json.dumps({'status':'rejected','reason':'python json.loads: '+str(e)}));sys.exit(0)",
  "try:",
  "    c=json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)",
  "except Exception as e:",
  "    print(json.dumps({'status':'rejected','reason':'python json.dumps: '+str(e)}));sys.exit(0)",
  // The encode step is inside a try on purpose. CPython's json accepts a lone
  // surrogate escape on input and re-emits it on output, but the resulting str has
  // no UTF-8 encoding, so it cannot be digested at all. That is a real divergence
  // from the V8 arms (which encode lone surrogates as WTF-8-ish bytes), and it must
  // be recorded as a rejection rather than crashing the census.
  "try:",
  "    b=c.encode('utf-8')",
  "except Exception as e:",
  "    print(json.dumps({'status':'rejected','reason':'python utf-8 encode of canonical form: '+str(e)}));sys.exit(0)",
  "d=hashlib.sha256(b).hexdigest()",
  "print(json.dumps({'status':'digest','digest':d,'canonicalForm':c}))"
].join("\n");

function runPythonArm(rawJson: string): ArmOutcome {
  const probe = probePython();
  if (!probe.available) {
    return rejected(`python3 unavailable: ${probe.detail}`);
  }
  const stdout = execFileSync("python3", ["-c", PYTHON_PROGRAM], {
    input: rawJson,
    encoding: "utf8",
    timeout: 30_000
  });
  const parsed = JSON.parse(stdout) as { status: string; reason?: string; digest?: string; canonicalForm?: string };
  if (parsed.status === "rejected") {
    return rejected(parsed.reason ?? "python arm rejected without a reason");
  }
  return { status: "digest", digest: parsed.digest as string, canonicalForm: parsed.canonicalForm as string };
}

/**
 * `verifiers/node/ghost_receipt_verify.mjs` is ESM and this file is compiled to
 * CommonJS, so the arm is loaded through a dynamic import resolved once. The
 * loader is exposed so tests can await readiness before running the census.
 */
type IndependentVerifierModule = { canonicalize: (value: unknown) => string };
let independentVerifierModule: IndependentVerifierModule | null = null;

export async function loadIndependentVerifier(): Promise<IndependentVerifierModule> {
  if (independentVerifierModule) {
    return independentVerifierModule;
  }
  const modulePath = resolve(__dirname, "../../verifiers/node/ghost_receipt_verify.mjs");
  const loaded = loadEsmModule<IndependentVerifierModule>(modulePath);
  if (typeof loaded.canonicalize !== "function") {
    throw new Error("ghost_ark.e1: verifiers/node/ghost_receipt_verify.mjs did not export canonicalize()");
  }
  independentVerifierModule = loaded;
  return loaded;
}

function wrapThrow(run: () => string): ArmOutcome {
  try {
    return digestOf(run());
  } catch (error) {
    return rejected(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Build the arm list. Async because the independent-verifier arm is ESM.
 */
export async function buildArms(): Promise<CanonicalizerArm[]> {
  const independent = await loadIndependentVerifier();

  return [
    {
      id: "ghost-ark-receipt-schema",
      independentParser: false,
      description: "V8 JSON.parse + packages/receipt-schema/src/hashCanonicalization.ts canonicalize",
      run: (rawJson) =>
        wrapThrow(() => {
          const parsed: unknown = JSON.parse(rawJson);
          return receiptSchemaCanonicalize(parsed);
        })
    },
    {
      id: "ghost-ark-independent-verifier",
      independentParser: false,
      description: "V8 JSON.parse + verifiers/node/ghost_receipt_verify.mjs canonicalize (built-ins only)",
      run: (rawJson) =>
        wrapThrow(() => {
          const parsed: unknown = JSON.parse(rawJson);
          return independent.canonicalize(parsed);
        })
    },
    {
      // The mitigation arm. Same canonicalizer as ghost-ark-receipt-schema, but input passes
      // text-level admission control BEFORE JSON.parse — which is where E1 showed all three
      // of Ghost-Ark's unintended kernel members actually occur. If this arm still reports
      // unintended kernel members, the mitigation does not work and must not be shipped.
      id: "ghost-ark-strict-admission",
      independentParser: false,
      description: "parseStrictJson (text-level admission control) + packages/receipt-schema canonicalize",
      run: (rawJson) =>
        wrapThrow(() => {
          const parsed: unknown = parseStrictJson(rawJson);
          return receiptSchemaCanonicalize(parsed);
        })
    },
    {
      id: "naive-sorted-stringify",
      independentParser: false,
      description: "V8 JSON.parse + homebrew sort-keys serializer (control arm)",
      run: (rawJson) =>
        wrapThrow(() => {
          const parsed: unknown = JSON.parse(rawJson);
          return naiveSortedStringify(parsed);
        })
    },
    {
      id: "python-json-sorted",
      independentParser: true,
      description: "CPython json.loads + json.dumps(sort_keys=True, separators=(',',':'), allow_nan=False)",
      run: (rawJson) => runPythonArm(rawJson)
    }
  ];
}
