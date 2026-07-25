/**
 * Myers O(ND) diff (Myers 1986, "An O(ND) Difference Algorithm and Its
 * Variations") over arbitrary token sequences, plus a preimage inspector that
 * shows exactly how a raw payload is transmuted into the bytes that get signed.
 *
 * WHY THIS EXISTS. Canonicalization silently rewrites the input: whitespace is
 * stripped, object keys are reordered, numbers are re-serialized. An auditor is
 * asked to trust that "the signature covers this payload" — but the payload
 * they read and the bytes that were signed are not the same string. This engine
 * makes that transformation inspectable character by character, so the
 * canonicalization step stops being an act of faith.
 *
 * HONEST SCOPE. This is a text-comparison utility, not a cryptographic control.
 * It explains a transformation; it proves nothing on its own. The proof is the
 * digest/signature check in the verifier. A diff that "looks right" is not
 * evidence — only the recomputed digest is.
 *
 * The implementation is the real greedy LCS/SES algorithm: a per-d trace of the
 * furthest-reaching V array, snake extension along diagonals, then backtracking
 * to recover the edit script. It is NOT a heuristic or a naive LCS table.
 */

export type DiffOpKind = "equal" | "delete" | "insert";

export interface DiffOp {
  kind: DiffOpKind;
  /** The token run this op covers (already joined for rendering). */
  value: string;
}

export interface DiffResult {
  ops: DiffOp[];
  /** Myers edit distance D (number of insertions + deletions). */
  editDistance: number;
  /** True when the computation hit `maxD` and returned a coarse fallback. */
  truncated: boolean;
}

/**
 * Greedy Myers diff over two token arrays. `maxD` bounds the work: the
 * algorithm is O(ND), so a pathological pair is cut off and reported as
 * `truncated` rather than hanging the UI — an honest degradation, never a
 * silently wrong diff.
 */
export function myersDiffTokens(a: string[], b: string[], maxD = 4000): DiffResult {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  // V is indexed by diagonal k ∈ [-max, max], offset into a flat array.
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  // Round d only ever reads diagonals in [-d, d], so snapshotting the full
  // 2*max+2 array every round is wasted memory: at the default bound a single
  // ordinary receipt retained ~10 MB per call (and 128 MB in the worst case).
  // Store just the live band, which is what backtracking actually indexes.
  const trace: Int32Array[] = [];

  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(Math.max(0, offset - d - 1), Math.min(v.length, offset + d + 2)));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // move down (insertion from b)
      } else {
        x = v[k - 1 + offset] + 1; // move right (deletion from a)
      }
      let y = x - k;
      // Snake: extend along the diagonal while tokens match.
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }

  if (found < 0) {
    // Hit the bound: report a coarse, still-truthful result.
    return {
      ops: [
        ...(a.length ? [{ kind: "delete" as const, value: a.join("") }] : []),
        ...(b.length ? [{ kind: "insert" as const, value: b.join("") }] : []),
      ],
      editDistance: n + m,
      truncated: true,
    };
  }

  // Backtrack through the recorded traces to recover the edit script.
  const script: Array<{ kind: DiffOpKind; token: string }> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const vPrev = trace[d];
    // Band-relative indexing: trace[d] starts at absolute offset-d-1.
    const base = Math.max(0, offset - d - 1);
    const at = (kk: number): number => vPrev[kk + offset - base];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      script.push({ kind: "equal", token: a[x] });
    }
    if (x === prevX) {
      y -= 1;
      script.push({ kind: "insert", token: b[y] });
    } else {
      x -= 1;
      script.push({ kind: "delete", token: a[x] });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    script.push({ kind: "equal", token: a[x] });
  }
  while (x > 0) { x -= 1; script.push({ kind: "delete", token: a[x] }); }
  while (y > 0) { y -= 1; script.push({ kind: "insert", token: b[y] }); }

  script.reverse();

  // Coalesce consecutive same-kind tokens into runs for rendering.
  const ops: DiffOp[] = [];
  for (const step of script) {
    const last = ops[ops.length - 1];
    if (last && last.kind === step.kind) last.value += step.token;
    else ops.push({ kind: step.kind, value: step.token });
  }
  return { ops, editDistance: found, truncated: false };
}

/** Character-level diff (each character is a token). */
export function myersDiffChars(a: string, b: string, maxD = 4000): DiffResult {
  return myersDiffTokens([...a], [...b], maxD);
}

export interface PreimageInspection {
  /** The raw text exactly as supplied (never re-serialized). */
  raw: string;
  /** The canonical bytes that are actually hashed and signed. */
  canonical: string;
  /** Edit script from raw → canonical. */
  diff: DiffResult;
  /** Byte lengths, so the size delta of canonicalization is visible. */
  rawBytes: number;
  canonicalBytes: number;
  /** Plain-language summary of what canonicalization did. */
  transformations: string[];
}

/**
 * Explains the raw → canonical transmutation for a payload. `canonicalize` is
 * injected so this module never owns a second canonicalizer (single source of
 * truth stays in webReceiptVerifier).
 */
export function inspectPreimage(
  rawText: string,
  canonicalize: (value: unknown) => string,
  maxD = 4000,
): PreimageInspection | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return { error: `raw text is not parseable JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  let canonical: string;
  try {
    canonical = canonicalize(parsed);
  } catch (e) {
    return { error: `canonicalization rejected this value: ${e instanceof Error ? e.message : String(e)}` };
  }
  const diff = myersDiffChars(rawText, canonical, maxD);
  const enc = new TextEncoder();
  return {
    raw: rawText,
    canonical,
    diff,
    rawBytes: enc.encode(rawText).length,
    canonicalBytes: enc.encode(canonical).length,
    transformations: describeTransformations(rawText, canonical),
  };
}

/**
 * Observations derived from the actual strings — never generic boilerplate.
 *
 * It deliberately re-parses `raw` instead of accepting a caller-supplied object:
 * an earlier signature took `parsed` as a parameter, and a caller passing an
 * object whose key order did not match the raw text made this function report a
 * key reordering that never occurred. A component whose entire purpose is to
 * describe a transformation honestly must not have an argument that can make it
 * lie, so the only input it trusts is the text itself.
 */
function describeTransformations(raw: string, canonical: string): string[] {
  const out: string[] = [];
  const rawWs = (raw.match(/\s/gu) ?? []).length;
  const canonWs = (canonical.match(/\s/gu) ?? []).length;
  if (rawWs > canonWs) out.push(`${rawWs - canonWs} whitespace character(s) removed (insignificant JSON whitespace is not signed).`);
  // Key order must be read from the SOURCE TEXT, not Object.keys(): JS
  // enumerates integer-like keys first in ascending numeric order regardless of
  // where they appeared, so `{"10":1,"9":2}` — which canonicalizes
  // byte-identically — was reported as a reorder that never happened, and any
  // object with such a key showed the auditor a fabricated "before" order.
  const rawOrderFromText = topLevelKeyOrderFromText(raw);
  if (rawOrderFromText) {
    const rawOrder = rawOrderFromText;
    const sorted = [...rawOrder].sort((l, r) => (l < r ? -1 : l > r ? 1 : 0));
    if (rawOrder.join(" ") !== sorted.join(" ")) {
      out.push(`top-level keys reordered to lexicographic order: [${rawOrder.join(", ")}] → [${sorted.join(", ")}].`);
    }
  }
  for (const nr of findNumberRewrites(raw)) out.push(nr);

  // THE LOAD-BEARING GATE. The heuristics above name three transformation
  // classes. Anything else — nested key reordering, string-escape folding,
  // duplicate-key elision, a whitespace INCREASE — left `out` empty, and the
  // fallback then asserted byte-identity that was measurably false (a
  // 4,000-document fuzz hit this on ~18% of inputs). "Nothing matched my
  // heuristics" is not "nothing changed": claim identity only when the bytes
  // actually are identical.
  if (raw === canonical) {
    return out.length === 0
      ? ["no observable transformation: the raw text is byte-identical to the canonical form."]
      : out;
  }
  if (out.length === 0) {
    out.push(
      "the text changed, but not in a way these heuristics name (e.g. nested key reordering, string-escape folding, or duplicate-key elision). The diff below is authoritative; this summary is not.",
    );
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Recovers the order of TOP-LEVEL object keys as they appear in the source
 * text. Returns null when the root is not an object. Scans at depth 1 only and
 * skips string contents, so a brace or colon inside a string cannot confuse the
 * depth tracking.
 */
function topLevelKeyOrderFromText(text: string): string[] | null {
  let i = 0;
  while (i < text.length && /\s/u.test(text[i])) i += 1;
  if (text[i] !== "{") return null;
  i += 1;
  const keys: string[] = [];
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      let literal = "";
      while (j < text.length) {
        if (text[j] === "\\") { literal += text[j] + (text[j + 1] ?? ""); j += 2; continue; }
        if (text[j] === '"') break;
        literal += text[j];
        j += 1;
      }
      if (depth === 0) {
        let k = j + 1;
        while (k < text.length && /\s/u.test(text[k])) k += 1;
        if (text[k] === ":") {
          try { keys.push(JSON.parse(`"${literal}"`) as string); } catch { keys.push(literal); }
        }
      }
      i = j + 1;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === "}") { if (depth === 0) break; depth -= 1; }
    i += 1;
  }
  return keys;
}

/**
 * Detects numeric literals whose canonical re-serialization differs from the
 * source text (e.g. `2.0` → `2`, `1e1` → `10`).
 *
 * CRITICAL: only genuine JSON *number tokens* are considered. String CONTENTS
 * are stripped first, because digits inside strings — a timestamp
 * "2026-07-07T00:00:00.000Z", a version "50.0.0", a hex receipt id — are not
 * numbers and are never re-serialized. Scanning them produced five fabricated
 * "transformations" on a receipt that canonicalization left byte-identical.
 * A glasshouse that invents a transformation is lying as much as one that
 * hides a real one, so this only reports rewrites it can actually justify.
 */
function findNumberRewrites(raw: string): string[] {
  const withoutStrings = stripJsonStringContents(raw);
  const out: string[] = [];
  const seen = new Set<string>();
  // A JSON number token per RFC 8259 grammar, anchored so it is not a fragment.
  const numberToken = /(?<![\w.])-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])/gu;
  for (const match of withoutStrings.matchAll(numberToken)) {
    const lit = match[0];
    if (seen.has(lit)) continue;
    seen.add(lit);
    const n = Number(lit);
    if (!Number.isFinite(n)) continue;
    const canonicalForm = Object.is(n, -0) ? "0" : JSON.stringify(n);
    if (canonicalForm !== lit) out.push(`numeric literal ${lit} re-serialized as ${canonicalForm}.`);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Replaces the CONTENTS of every JSON string literal with spaces, preserving
 * length and structure so number-token scanning cannot see inside strings.
 * Handles backslash escapes so an escaped quote does not end the string early.
 */
function stripJsonStringContents(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') { inString = true; out += ch; } else out += ch;
      continue;
    }
    if (escaped) { escaped = false; out += " "; continue; }
    if (ch === "\\") { escaped = true; out += " "; continue; }
    if (ch === '"') { inString = false; out += ch; continue; }
    out += " ";
  }
  return out;
}
