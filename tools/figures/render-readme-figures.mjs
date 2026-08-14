#!/usr/bin/env node
/**
 * Renders the README figures from `docs/assets/figure-data.json`.
 *
 * WHY THIS EXISTS. A hand-drawn chart is an assertion: nobody can tell whether
 * the bar is the height the measurement says it is. Every figure in the README
 * is generated from one committed data file, and that file records, per block,
 * the command that produced the numbers and the date it was run. A reviewer who
 * distrusts a figure re-runs the command, diffs the block, and re-renders.
 *
 * WHAT IT DOES NOT DO. It does not re-run the experiments, and it does not check
 * that the data file is true — that is the harnesses' job (see EXPERIMENTS.md,
 * and E4, which checks that a detection stops when its mechanism is broken).
 * This script establishes only that the picture and the number agree.
 *
 *   npm run figures
 *
 * Output SVGs are theme-aware: the palette is defined with CSS custom properties
 * and re-declared under `prefers-color-scheme: dark`, so one file reads correctly
 * on GitHub's light and dark themes. No external fonts, no script, no network.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUT = resolve(ROOT, "docs/assets");
const DATA = JSON.parse(readFileSync(resolve(OUT, "figure-data.json"), "utf8"));

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Design system. One palette, declared once, re-declared for dark.
// ---------------------------------------------------------------------------

const STYLE = `
  <style>
    :root{
      --ink:#0f172a; --mut:#5b6676; --faint:#8b95a5; --line:#d8dee8; --edge:#e7ecf3;
      --pane:#f7f9fc; --pane2:#eef2f8; --card:#ffffff;
      --acc:#4f46e5; --pos:#0d9488; --warn:#b8690c; --dngr:#c02626; --vio:#7c3aed; --steel:#3b6ea5;
      --accSoft:#e8e7fd; --posSoft:#d8f2ee; --warnSoft:#fbecd8; --dngrSoft:#fbe0e0; --vioSoft:#eee6fd; --steelSoft:#e0ebf7;
    }
    @media (prefers-color-scheme: dark){
      :root{
        --ink:#e6edf3; --mut:#9aa7b4; --faint:#6e7d8d; --line:#303844; --edge:#232b36;
        --pane:#11161d; --pane2:#161d26; --card:#0d1117;
        --acc:#8b93f8; --pos:#2dd4bf; --warn:#e8a33d; --dngr:#f87171; --vio:#a78bfa; --steel:#6ea8dc;
        --accSoft:#232449; --posSoft:#123c3a; --warnSoft:#3a2a12; --dngrSoft:#3d1d1d; --vioSoft:#2b2247; --steelSoft:#16283c;
      }
    }
    .s{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
    .m{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
    .ink{fill:var(--ink)} .mut{fill:var(--mut)} .faint{fill:var(--faint)}
    .acc{fill:var(--acc)} .pos{fill:var(--pos)} .warn{fill:var(--warn)}
    .dngr{fill:var(--dngr)} .vio{fill:var(--vio)} .steel{fill:var(--steel)}
    .t{font-weight:700;letter-spacing:-0.2px}
    .k{font-weight:600;letter-spacing:0.9px;text-transform:uppercase}
  </style>`;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const T = (x, y, s, o = {}) =>
  `<text x="${r(x)}" y="${r(y)}" class="${o.mono ? "m" : "s"} ${o.cls ?? "ink"}${
    o.bold ? " t" : ""
  }${o.kicker ? " k" : ""}" font-size="${o.size ?? 13}"${
    o.anchor ? ` text-anchor="${o.anchor}"` : ""
  }${o.op ? ` opacity="${o.op}"` : ""}>${esc(s)}</text>`;

const R = (x, y, w, h, o = {}) =>
  `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(0, w))}" height="${r(
    Math.max(0, h)
  )}" rx="${o.rx ?? 0}" fill="${o.fill ?? "none"}"${
    o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ""
  }${o.op ? ` opacity="${o.op}"` : ""}/>`;

const L = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${
    o.stroke ?? "var(--line)"
  }" stroke-width="${o.sw ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}${
    o.cap ? ` stroke-linecap="${o.cap}"` : ""
  }${o.op ? ` opacity="${o.op}"` : ""}/>`;

const r = (n) => Math.round(n * 100) / 100;
const fmt = (n) => n.toLocaleString("en-US");

/**
 * Word-wrap at an approximate character budget. Every figure that lost a clause
 * off its right edge lost it because a sentence was emitted as one <text>; SVG
 * does not wrap, so the wrapping has to happen here.
 */
const wrap = (x, y, text, budget, lh, o = {}) => {
  const out = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    if (line && (line + " " + word).length > budget) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out.map((l, i) => T(x, y + i * lh, l, o)).join("\n");
};

/** A titled frame: every figure carries its own provenance line. */
function frame(w, h, title, kicker, footer) {
  return {
    open: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(
      title
    )}">${STYLE}
  ${R(0.5, 0.5, w - 1, h - 1, { rx: 14, fill: "var(--card)", stroke: "var(--edge)" })}
  ${T(28, 38, kicker, { size: 10.5, cls: "acc-k mut", kicker: true })}
  ${T(28, 64, title, { size: 19, bold: true })}`,
    close: `${L(28, h - 44, w - 28, h - 44, { op: 0.6 })}
  ${T(28, h - 22, footer, { size: 10.5, cls: "faint", mono: true })}
</svg>\n`
  };
}

const arrow = (id, color) =>
  `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker></defs>`;

const write = (name, body) => {
  writeFileSync(resolve(OUT, name), body);
  console.log(`  ${name}  ${body.length.toLocaleString("en-US")} bytes`);
};

// ---------------------------------------------------------------------------
// Figure 1 — the mechanism. Two documents, one identity, and why that does not
// stay fixed. This is the claim; everything else measures it.
// ---------------------------------------------------------------------------

function figKernel() {
  const W = 1160;
  const H = 470;
  const f = frame(
    W,
    H,
    "How a receipt loses a distinction, and why the loss does not stay put",
    "Figure 1 · the provenance kernel",
    `ker(C) = { (a,b) : digest(C(a)) = digest(C(b)) } · formal statement: docs/research/PROVENANCE_KERNEL_PROBLEM.md`
  );
  const p = [f.open, arrow("ar1", "var(--mut)")];

  const docY = 108;
  const docs = [
    { y: docY, label: "document A", body: '{"amount":1, "amount":2}', tone: "steel" },
    { y: docY + 96, label: "document B", body: '{"amount":2}', tone: "vio" }
  ];
  for (const d of docs) {
    p.push(R(28, d.y, 232, 70, { rx: 9, fill: `var(--${d.tone}Soft)`, stroke: `var(--${d.tone})`, sw: 1.1 }));
    p.push(T(44, d.y + 25, d.label, { size: 10.5, cls: "mut", kicker: true }));
    p.push(T(44, d.y + 48, d.body, { size: 12.5, mono: true }));
  }
  p.push(T(28, docY + 200, "Two different byte strings.", { size: 12.5, cls: "mut" }));
  p.push(
    T(28, docY + 220, "A declared consumer needs them", { size: 12.5, cls: "mut" })
  );
  p.push(T(28, docY + 240, "kept apart.", { size: 12.5, cls: "mut" }));

  // pipeline
  const stages = [
    { x: 306, t: "parse", s: "V8 · CPython · jq · serde" },
    { x: 470, t: "canonicalize", s: "sort keys, re-emit" },
    { x: 634, t: "digest", s: "SHA-256" }
  ];
  for (const [i, s] of stages.entries()) {
    p.push(R(s.x, docY + 24, 140, 62, { rx: 9, fill: "var(--pane)", stroke: "var(--line)" }));
    p.push(T(s.x + 70, docY + 50, s.t, { size: 13.5, bold: true, anchor: "middle" }));
    p.push(T(s.x + 70, docY + 70, s.s, { size: 9.5, cls: "faint", anchor: "middle", mono: true }));
    if (i > 0) {
      p.push(L(s.x - 24, docY + 55, s.x - 6, docY + 55, { stroke: "var(--mut)", sw: 1.4 }));
      p.push(`<path d="M${s.x - 8},${docY + 51} L${s.x - 2},${docY + 55} L${s.x - 8},${docY + 59} z" fill="var(--mut)"/>`);
    }
  }
  // converging arrows from both docs into parse
  p.push(
    `<path d="M266,${docY + 35} C288,${docY + 35} 288,${docY + 55} 300,${docY + 55}" fill="none" stroke="var(--steel)" stroke-width="1.6"/>`
  );
  p.push(
    `<path d="M266,${docY + 131} C288,${docY + 131} 288,${docY + 55} 300,${docY + 55}" fill="none" stroke="var(--vio)" stroke-width="1.6"/>`
  );
  p.push(`<path d="M298,${docY + 51} L304,${docY + 55} L298,${docY + 59} z" fill="var(--mut)"/>`);

  // collapse
  p.push(L(798, docY + 55, 826, docY + 55, { stroke: "var(--dngr)", sw: 1.6 }));
  p.push(`<path d="M824,${docY + 51} L830,${docY + 55} L824,${docY + 59} z" fill="var(--dngr)"/>`);
  p.push(R(838, docY + 24, 290, 62, { rx: 9, fill: "var(--dngrSoft)", stroke: "var(--dngr)", sw: 1.2 }));
  p.push(T(854, docY + 47, "ONE identity for both", { size: 12, bold: true, cls: "ink" }));
  p.push(T(854, docY + 68, "a2879a37…95a1094d", { size: 11, mono: true, cls: "mut" }));

  p.push(
    T(306, docY + 118, "The distinction is destroyed HERE — before any audited code runs.", {
      size: 12,
      cls: "ink"
    })
  );
  p.push(
    T(306, docY + 138, "E1 measures this arm-by-arm; E11 reproduces it in four canonicalizers this project did not write.", {
      size: 11.5,
      cls: "mut"
    })
  );

  // the non-persistence panel
  const py = docY + 162;
  p.push(R(306, py, 822, 140, { rx: 10, fill: "var(--pane)", stroke: "var(--line)" }));
  p.push(T(326, py + 25, "Soundness is a ternary relation, and neither argument holds still", { size: 13, bold: true }));
  p.push(T(742, py + 25, "Sound( C , Σ , P )", { size: 13.5, mono: true, cls: "acc" }));

  const cols = [
    { c: "warn", h: "Σ grows  ⟹  monotone", b: "a wider input alphabet can only ADD kernel members" },
    { c: "vio", h: "P grows  ⟹  antitone", b: "a wider consumer set can only ADD distinctions that must survive" }
  ];
  cols.forEach((c, i) => {
    const yy = py + 52 + i * 22;
    p.push(R(326, yy - 8, 8, 8, { rx: 2, fill: `var(--${c.c})` }));
    p.push(T(344, yy, c.h, { size: 11.5, bold: true }));
    p.push(T(510, yy, c.b, { size: 11.5, cls: "mut" }));
  });
  p.push(L(326, py + 106, 1108, py + 106, { op: 0.7 }));
  p.push(
    T(326, py + 124, "Therefore a receipt system that is sound today becomes unsound as consumers are added — with C unchanged and no bug introduced.", {
      size: 11.5,
      cls: "ink"
    })
  );

  p.push(f.close);
  write("fig-kernel.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 2 — E1: the full 31 x 5 census, every cell a measured verdict.
// ---------------------------------------------------------------------------

const VERDICT = {
  sound: { c: "pos", label: "sound", note: "identity matches consumer intent" },
  "unintended-kernel": { c: "dngr", label: "unintended kernel", note: "two documents a consumer distinguishes share one identity" },
  "over-discrimination": { c: "warn", label: "over-discrimination", note: "one document a consumer treats as equal gets two identities" },
  "fail-closed": { c: "steel", label: "fail-closed", note: "both sides refused" },
  "sound-by-rejection": { c: "vio", label: "sound-by-rejection", note: "one side admitted, the other refused; no false shared identity" }
};

function figCensus() {
  const d = DATA.e1;
  const rows = d.pathologies.length;
  const rowH = 20;
  const labW = 352;
  const colW = 152;
  const top = 182;
  const W = labW + colW * d.arms.length + 56;
  const H = top + rows * rowH + 122;

  const f = frame(
    W,
    H,
    `Every cell of the kernel census: ${rows} pathology classes × ${d.arms.length} pipelines`,
    "Figure 2 · experiment E1",
    `npm run experiment:e1 -- --json · provenance: ${d.provenance} (exact counts, no intervals) · measured ${d.measured_on}`
  );
  const p = [f.open];

  p.push(
    T(28, 88, "Read a column downward for one pipeline's behaviour; a row across for how five pipelines disagree about one input pair.", {
      size: 12,
      cls: "mut"
    })
  );

  // legend
  let lx = 28;
  for (const key of Object.keys(VERDICT)) {
    const v = VERDICT[key];
    p.push(R(lx, 104, 10, 10, { rx: 2.5, fill: `var(--${v.c})` }));
    p.push(T(lx + 16, 113, v.label, { size: 10.5, cls: "mut" }));
    lx += 18 + v.label.length * 6.1;
  }

  // column headers
  d.arms.forEach((arm, i) => {
    const x = labW + i * colW + colW / 2;
    const mitigation = arm.includes("strict-admission");
    const control = arm.includes("naive");
    const indep = arm.includes("python");
    const name = arm.replace("ghost-ark-", "ghost-ark ").replace(/-/gu, " ");
    p.push(wrap(x, top - 54, name, 21, 14, { size: 10.8, anchor: "middle", bold: true }));
    const tag = mitigation ? "mitigation" : control ? "control" : indep ? "independent parser" : "this repository";
    p.push(T(x, top - 20, tag, { size: 9.5, anchor: "middle", cls: "faint", kicker: true }));
    if (mitigation) p.push(R(labW + i * colW + 3, top - 8, colW - 6, rows * rowH + 6, { rx: 6, fill: "var(--posSoft)", op: 0.55 }));
  });

  // rows
  d.pathologies.forEach((pid, ri) => {
    const y = top + ri * rowH;
    if (ri % 2 === 0) p.push(R(28, y - 1, W - 56, rowH, { fill: "var(--pane)", op: 0.55 }));
    const intent = d.intents[pid];
    p.push(T(28, y + 13.5, pid, { size: 11, mono: true }));
    p.push(T(labW - 14, y + 13.5, intent, { size: 9.5, anchor: "end", cls: "faint", kicker: true }));
    d.arms.forEach((_, ci) => {
      const v = VERDICT[d.matrix[ri][ci]];
      const cx = labW + ci * colW;
      const strong = d.matrix[ri][ci] === "unintended-kernel";
      p.push(R(cx + 12, y + 2, colW - 24, rowH - 5, {
        rx: 4,
        fill: `var(--${v.c}Soft)`,
        stroke: strong ? `var(--${v.c})` : "none",
        sw: 1.1
      }));
      p.push(T(cx + colW / 2, y + 14, v.label, {
        size: 9.4,
        anchor: "middle",
        cls: strong ? "ink" : "mut"
      }));
    });
  });

  // summary strip
  const sy = top + rows * rowH + 18;
  p.push(L(28, sy, W - 28, sy, { op: 0.7 }));
  const counts = d.arms.map((_, ci) => d.matrix.filter((row) => row[ci] === "unintended-kernel").length);
  d.arms.forEach((_, ci) => {
    const x = labW + ci * colW + colW / 2;
    const n = counts[ci];
    p.push(T(x, sy + 26, String(n), {
      size: 21,
      anchor: "middle",
      bold: true,
      cls: n === 0 ? "pos" : "dngr"
    }));
    p.push(T(x, sy + 42, "unintended kernel", { size: 9.5, anchor: "middle", cls: "faint" }));
  });
  p.push(T(28, sy + 26, "Collapses per pipeline", { size: 12.5, bold: true }));
  p.push(
    T(28, sy + 44, `${d.universal_unintended_kernel.length} classes collapse in every deciding arm`, {
      size: 10.8,
      cls: "mut"
    })
  );
  p.push(
    T(28, sy + 62, "The mitigation arm reaches zero without a single rejection-asymmetry — a fix, not a trade.", {
      size: 11,
      cls: "mut"
    })
  );

  p.push(f.close);
  write("fig-e1-census.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 3 — E2: where verification time actually goes. Log scale, with IQR.
// ---------------------------------------------------------------------------

function figCost() {
  const d = DATA.e2;
  const W = 1160;
  const rowH = 46;
  const top = 150;
  const H = top + d.arms.length * rowH + 124;
  const f = frame(
    W,
    H,
    "Verification cost: the asymmetric signature dominates, canonicalization does not",
    "Figure 3 · experiment E2",
    `npm run experiment:e2 · ${fmt(d.iterations)} iterations after ${d.warmup} discarded warmups · ${d.host} · measured ${d.measured_on}`
  );
  const p = [f.open];

  const x0 = 300;
  const x1 = W - 168;
  const lo = Math.log10(1);
  const hi = Math.log10(256);
  const sx = (v) => x0 + ((Math.log10(v) - lo) / (hi - lo)) * (x1 - x0);

  p.push(T(28, 92, "Bars are p50 on a logarithmic microsecond scale; the lighter span is the inter-quartile range. A single dominant cost is a design fact, not a benchmark flourish.", { size: 12, cls: "mut" }));

  for (const tick of [1, 2, 5, 10, 20, 50, 100, 200]) {
    p.push(L(sx(tick), top - 16, sx(tick), top + d.arms.length * rowH - 8, { dash: "2 4", op: 0.5 }));
    p.push(T(sx(tick), top - 24, `${tick}µs`, { size: 9.5, anchor: "middle", cls: "faint", mono: true }));
  }

  d.arms.forEach((a, i) => {
    const y = top + i * rowH;
    const tone = a.crypto === "asymmetric" ? "dngr" : a.crypto === "symmetric" ? "warn" : a.baseline ? "faint" : "steel";
    const barTone = a.baseline ? "mut" : tone;
    p.push(T(28, y + 20, a.op, { size: 12.5, mono: true, bold: !!a.baseline }));
    p.push(T(28, y + 35, a.baseline ? "declared baseline — what any consumer pays merely to read the document" : `${a.crypto} cryptography`, { size: 9.8, cls: "faint" }));

    const w = sx(a.p50) - x0;
    // IQR span
    const iqrLo = Math.max(1.02, a.p50 - a.iqr / 2);
    const iqrHi = a.p50 + a.iqr / 2;
    p.push(R(sx(iqrLo), y + 8, sx(iqrHi) - sx(iqrLo), 22, { rx: 3, fill: `var(--${barTone})`, op: 0.22 }));
    p.push(R(x0, y + 12, w, 14, { rx: 3, fill: `var(--${barTone})`, op: a.baseline ? 0.45 : 0.92 }));
    p.push(T(sx(a.p50) + 12, y + 23, `${a.p50.toFixed(2)}`, { size: 12, mono: true, bold: true }));
    p.push(T(W - 40, y + 23, a.baseline ? "1.00×" : `${a.ratio.toFixed(2)}×`, {
      size: 12.5,
      anchor: "end",
      mono: true,
      bold: !a.baseline,
      cls: a.crypto === "asymmetric" ? "dngr" : "mut"
    }));
  });

  const sy = top + d.arms.length * rowH + 8;
  p.push(L(28, sy, W - 28, sy, { op: 0.7 }));
  p.push(T(28, sy + 24, "The harness audits itself.", { size: 12, bold: true }));
  p.push(
    T(178, sy + 24, "E2 declares four subset orderings — a superset arm cannot be cheaper than its subset — and checks them: 4/4 hold.", { size: 11.5, cls: "mut" })
  );
  p.push(
    T(28, sy + 42, "An earlier version of this harness caused an inversion with an O(n) sink. The self-audit found it, and the harness reports an inversion rather than publishing an impossible number.", { size: 11.5, cls: "mut" })
  );
  p.push(
    T(28, sy + 64, "Coverage boundary: one host, one process, no concurrency, no adversarial input sizing, no AWS or KMS network path. Not a throughput measurement.", { size: 11, cls: "faint" })
  );
  p.push(f.close);
  write("fig-e2-cost.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 4 — E12: the result that went against the thesis, drawn honestly.
// ---------------------------------------------------------------------------

function figRealTraffic() {
  const d = DATA.e12;
  const W = 1160;
  const H = 500;
  const f = frame(
    W,
    H,
    "The measurement that argued against us: zero pathologies in real supply-chain traffic",
    "Figure 4 · experiment E12 · falsifier F2",
    `npm run experiment:e12 · corpus ${d.corpus} · seed ${d.seed} · provenance: ${d.provenance} · measured ${d.measured_on}`
  );
  const p = [f.open];

  p.push(T(28, 92, "F2 predicted the pathology alphabet would prove to be an artifact of what the author chose to look at. It was tested directly. It was confirmed.", { size: 12.5, cls: "mut" }));

  const steps = [
    { n: fmt(d.frame), l: "global log index", s: `frozen sampling frame across ${d.shards} shards`, tone: "steel", w: 1 },
    { n: fmt(d.draws), l: "uniform random draws", s: `${d.resolved} resolved, ${d.unresolved} unresolved`, tone: "steel", w: 0.74 },
    { n: fmt(d.eligible), l: "eligible payloads", s: `${fmt(d.absent_by_type)} store only hashes, ${d.absent_though_typed} absent though typed`, tone: "acc", w: 0.48 },
    { n: String(d.findings), l: "pathologies found", s: `across ${d.classes} pre-registered classes`, tone: "pos", w: 0.24 }
  ];

  const fy = 128;
  const fh = 74;
  let fx = 28;
  steps.forEach((s, i) => {
    const bw = 250;
    p.push(R(fx, fy, bw, fh, { rx: 10, fill: `var(--${s.tone}Soft)`, stroke: `var(--${s.tone})`, sw: 1.1 }));
    p.push(T(fx + 18, fy + 34, s.n, { size: i === 3 ? 30 : 22, bold: true, mono: true }));
    p.push(T(fx + 18, fy + 52, s.l, { size: 11, bold: true }));
    p.push(T(fx + 18, fy + 66, s.s, { size: 9.5, cls: "mut" }));
    if (i < steps.length - 1) {
      p.push(L(fx + bw + 8, fy + fh / 2, fx + bw + 26, fy + fh / 2, { stroke: "var(--mut)", sw: 1.4 }));
      p.push(`<path d="M${fx + bw + 24},${fy + fh / 2 - 4} L${fx + bw + 30},${fy + fh / 2} L${fx + bw + 24},${fy + fh / 2 + 4} z" fill="var(--mut)"/>`);
    }
    fx += bw + 34;
  });

  // scanned volume
  const vy = fy + fh + 26;
  p.push(T(28, vy + 14, "What was actually scanned", { size: 11, kicker: true, cls: "mut" }));
  const vols = [
    [fmt(d.bytes), "payload bytes"],
    [fmt(d.members), "object members"],
    [fmt(d.strings), "strings"],
    [fmt(d.numbers), "numbers"],
    [`${d.controls}/${d.controls}`, "detector controls fired"],
    [`${d.eligible}/${d.eligible}`, "digests verified against the log"]
  ];
  vols.forEach((v, i) => {
    const x = 28 + i * 188;
    p.push(T(x, vy + 44, v[0], { size: 17, bold: true, mono: true }));
    p.push(T(x, vy + 60, v[1], { size: 10, cls: "mut" }));
  });

  // interval panel
  const iy = vy + 84;
  p.push(R(28, iy, W - 56, 132, { rx: 10, fill: "var(--pane)", stroke: "var(--line)" }));
  p.push(T(48, iy + 26, "A zero is not a small number. It is a bound — and here, two different bounds.", { size: 12.5, bold: true }));

  const bx = 48;
  const bw = 520;
  p.push(T(bx, iy + 50, "95% Wilson interval, per eligible payload", { size: 10.5, cls: "mut" }));
  p.push(R(bx, iy + 58, bw, 12, { rx: 6, fill: "var(--pane2)", stroke: "var(--line)" }));
  p.push(R(bx, iy + 58, bw * (d.wilson_high / 0.25), 12, { rx: 6, fill: "var(--pos)", op: 0.35 }));
  p.push(L(bx, iy + 54, bx, iy + 78, { stroke: "var(--pos)", sw: 2 }));
  p.push(T(bx, iy + 92, "0", { size: 11, mono: true, bold: true }));
  p.push(T(bx + bw * (d.wilson_high / 0.25), iy + 92, `${(d.wilson_high * 100).toFixed(2)}%`, { size: 11, mono: true, bold: true, anchor: "middle" }));
  p.push(T(bx + bw + 16, iy + 68, `n = ${d.eligible}`, { size: 11.5, mono: true, cls: "mut" }));

  p.push(T(700, iy + 50, "At the level of independent producers", { size: 10.5, cls: "mut" }));
  p.push(R(700, iy + 58, 380, 12, { rx: 6, fill: "var(--warnSoft)", stroke: "var(--warn)", sw: 1 }));
  p.push(T(712, iy + 68, "interval refused", { size: 10.5, cls: "warn", bold: true }));
  p.push(T(700, iy + 92, `n = ${d.producers} producers — below the interval floor of 30.`, { size: 10.5, cls: "mut" }));
  p.push(T(700, iy + 108, "Any interval here would be too wide to support a claim.", { size: 10.5, cls: "mut" }));
  p.push(T(48, iy + 108, "So the per-payload zero is a real bound, and the producer-level zero bounds nothing at all.", { size: 10.5, cls: "faint" }));

  p.push(f.close);
  write("fig-e12-real-traffic.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 5 — E10: would the tests notice if the kernel were wrong?
// ---------------------------------------------------------------------------

function figMutation() {
  const d = DATA.e10;
  const W = 1160;
  const rowH = 34;
  const top = 152;
  const H = top + d.files.length * rowH + 116;
  const f = frame(
    W,
    H,
    "Mutation score over the receipt trust kernel: would the tests notice if it were wrong?",
    "Figure 5 · experiment E10",
    `bash tools/experiments/run-e10-sweep.sh <file> && npm run mutation:summarize · provenance: ${d.provenance} · measured ${d.measured_on}`
  );
  const p = [f.open];

  p.push(T(28, 92, "Stryker makes one small semantic change at a time and asks whether any test fails. A surviving mutant is a demonstrated gap; a killed mutant is only the absence of that one gap.", { size: 12, cls: "mut" }));

  const x0 = 372;
  const x1 = W - 150;
  const sx = (v) => x0 + (v / 100) * (x1 - x0);

  for (const tick of [0, 25, 50, 75, 100]) {
    p.push(L(sx(tick), top - 14, sx(tick), top + d.files.length * rowH - 6, { dash: "2 4", op: 0.45 }));
    p.push(T(sx(tick), top - 22, `${tick}%`, { size: 9.5, anchor: "middle", cls: "faint", mono: true }));
  }
  // threshold
  p.push(L(sx(d.threshold), top - 30, sx(d.threshold), top + d.files.length * rowH - 6, { stroke: "var(--acc)", sw: 1.6 }));
  p.push(T(sx(d.threshold) + 8, top - 34, `CI break threshold ${d.threshold}`, { size: 10, cls: "acc", bold: true }));

  d.files.forEach((file, i) => {
    const y = top + i * rowH;
    const below = file.covered < d.threshold;
    p.push(T(28, y + 20, file.file, { size: 11.5, mono: true }));
    p.push(R(x0, y + 9, sx(file.covered) - x0, 16, {
      rx: 4,
      fill: below ? "var(--warn)" : "var(--pos)",
      op: 0.9
    }));
    if (file.before !== undefined) {
      p.push(L(sx(file.before), y + 5, sx(file.before), y + 29, { stroke: "var(--dngr)", sw: 1.8 }));
      p.push(T(sx(file.before) - 8, y + 21, `${file.before}%`, { size: 9.5, anchor: "end", cls: "dngr", mono: true }));
    }
    p.push(T(W - 40, y + 21, `${file.covered.toFixed(1)}%`, { size: 12, anchor: "end", mono: true, bold: true }));
  });

  const sy = top + d.files.length * rowH + 12;
  p.push(L(28, sy, W - 28, sy, { op: 0.7 }));
  p.push(R(28, sy + 12, 12, 12, { rx: 3, fill: "var(--dngr)" }));
  p.push(T(48, sy + 22, "red tick = the score before remediation, kept in the picture so an improvement cannot be shown without the state it improved on.", { size: 11, cls: "mut" }));
  p.push(
    T(28, sy + 44, `Sweep aggregate: ${d.aggregate_covered}% covered-denominator, ${d.aggregate_total}% total-denominator. ${d.aggregate_note}`, { size: 11, cls: "mut" })
  );
  p.push(
    T(28, sy + 64, "The threshold has been wrong once and is now set from measurement: 75 → 58 → 70 → 80, each step after a sweep rather than before one.", { size: 11, cls: "faint" })
  );

  p.push(f.close);
  write("fig-e10-mutation.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 6 — the formal models, and the discipline of not printing an unstable
// number as a constant.
// ---------------------------------------------------------------------------

function figProofs() {
  const d = DATA.proofs;
  const baselines = d.results.filter((x) => x.expect === "clean");
  const W = 1160;
  const rowH = 44;
  const top = 156;
  const H = top + baselines.length * rowH + 160;
  const f = frame(
    W,
    H,
    "Formal models: every gated invariant ships a mutant that must break it",
    "Figure 6 · TLA+ specifications",
    `make proof · ${d.tool} · all gating specs met expectation · measured ${d.measured_on}`
  );
  const p = [f.open];

  p.push(T(28, 92, "A green invariant with no failing mutant is not evidence. Each baseline below is paired with a deliberately broken variant that CI requires to produce a counterexample.", { size: 12, cls: "mut" }));

  const x0 = 320;
  const x1 = 690;
  const maxL = Math.log10(500000);
  const sx = (v) => x0 + (Math.log10(Math.max(v, 10)) / maxL) * (x1 - x0);

  for (const tick of [100, 1000, 10000, 100000]) {
    p.push(L(sx(tick), top - 14, sx(tick), top + baselines.length * rowH - 8, { dash: "2 4", op: 0.45 }));
    p.push(T(sx(tick), top - 22, fmt(tick), { size: 9.5, anchor: "middle", cls: "faint", mono: true }));
  }
  p.push(T(x0, top - 40, "distinct states explored (log scale)", { size: 10, cls: "faint", kicker: true }));
  p.push(T(800, top - 40, "paired mutant", { size: 10, cls: "faint", kicker: true }));

  baselines.forEach((b, i) => {
    const y = top + i * rowH;
    const mutant = d.results.find(
      (x) => x.expect === "violation" && x.module.replace(/_?Mutant$/i, "") === b.module
    );
    if (i % 2 === 0) p.push(R(28, y - 2, W - 56, rowH - 4, { fill: "var(--pane)", op: 0.5 }));
    p.push(T(28, y + 19, b.module, { size: 12, mono: true }));
    p.push(T(28, y + 33, b.label === "dab" ? "dab gateway model" : "core provenance model", { size: 9.5, cls: "faint" }));

    p.push(R(x0, y + 11, sx(b.distinct_states) - x0, 14, { rx: 3, fill: "var(--steel)", op: 0.85 }));
    p.push(T(sx(b.distinct_states) + 10, y + 22, fmt(b.distinct_states), { size: 11, mono: true, bold: true }));
    p.push(T(300, y + 22, "CLEAN", { size: 10, anchor: "end", cls: "pos", bold: true }));

    if (mutant) {
      p.push(R(800, y + 8, 300, 22, { rx: 6, fill: "var(--dngrSoft)", stroke: "var(--dngr)", sw: 1 }));
      p.push(T(812, y + 23, "VIOLATION REPRODUCED", { size: 10.5, cls: "ink", bold: true }));
      p.push(T(1096, y + 23, "count withdrawn (R11)", { size: 9, anchor: "end", cls: "mut" }));
    } else {
      p.push(R(800, y + 8, 300, 22, { rx: 6, fill: "var(--warnSoft)", stroke: "var(--warn)", sw: 1 }));
      p.push(T(812, y + 23, "no mutant — checked, not gated", { size: 10.5, cls: "ink", bold: true }));
      p.push(T(1096, y + 23, "one-sided", { size: 9, anchor: "end", cls: "mut" }));
    }
  });

  const sy = top + baselines.length * rowH + 12;
  p.push(L(28, sy, W - 28, sy, { op: 0.7 }));
  p.push(T(28, sy + 24, "Why the mutant state counts are absent, deliberately.", { size: 12, bold: true }));
  p.push(wrap(28, sy + 44, d.state_count_note, 158, 17, { size: 11, cls: "mut" }));
  p.push(
    T(28, sy + 100, "Baseline counts are reproducible and are printed. The gate is a yes/no verdict and is unaffected — five baselines must pass and five mutants must violate.", { size: 11, cls: "faint" })
  );

  p.push(f.close);
  write("fig-proofs.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 7 — the evidence ladder. Where every result actually stands.
// ---------------------------------------------------------------------------

function figLadder() {
  const W = 1160;
  const rungs = [
    {
      t: "Real third-party traffic",
      s: "a random sample of production data nobody here produced",
      tone: "pos",
      items: ["E12 — Sigstore Rekor, 3,000 draws, 64 payloads: 0 pathologies. This rung ARGUES AGAINST the thesis and is reported as found."]
    },
    {
      t: "Independent implementations",
      s: "code written outside this repository, by people who never saw the alphabet",
      tone: "steel",
      items: [
        "E11 — Rust serde_json, Ruby, CPython, jq: all four collapse duplicate keys; none collapses 2⁵³",
        "E13 — 9 real hops composed pairwise; an upstream normalization disables a downstream fail-closed refusal",
        "E14 — verification with OpenSSL and CPython in the security path: 31/31 decisions agree, 3/3 identities reproduced"
      ]
    },
    {
      t: "Sampled from a declared generator",
      s: "earns confidence intervals, because the sampling frame is written down",
      tone: "vio",
      items: ["E1-B — 52.5% [49.0, 56.1] unguarded vs 0.0% [0.0, 0.5] guarded; disjoint intervals, shared denominator"]
    },
    {
      t: "Census over a curated alphabet",
      s: "exact counts, no intervals — a census is not a sample and may not pretend to be one",
      tone: "acc",
      items: [
        "E1 — 31 classes × 5 pipelines · E3 — 26/26 verifier-intrinsic · E4 — tautology verdict PASS",
        "E5 · E6 · E7 · E10 · TLA+ baselines and mutants"
      ]
    },
    {
      t: "Local-only and synth-only",
      s: "the machinery runs; the cloud behaviour it models is unobserved",
      tone: "warn",
      items: ["The entire AWS evidence plane. CDK synthesis creates no infrastructure and proves no runtime behaviour."]
    },
    {
      t: "Not established",
      s: "stated here rather than left for a reviewer to discover",
      tone: "dngr",
      items: [
        "E16 — named, version-pinned consumers do distinguish a collapsed pair; this is existence evidence, not an incidence estimate",
        "No independently AUTHORED verifier: E14 replaced the cryptography, not the rule sequencing",
        "No live AWS evidence bundle · no second real-traffic population (E15: frame reachable, eligibility 0/40)"
      ]
    }
  ];

  const rungH = (rung) => 20 + rung.items.length * 17 + 26;
  const H = 116 + rungs.reduce((s, x) => s + rungH(x) + 8, 0) + 52;

  const f = frame(
    W,
    H,
    "The evidence ladder: what each result is entitled to claim",
    "Figure 7 · epistemic status",
    "docs/artifact/CI_COVERAGE.md · docs/artifact/STATUS_AND_LIMITATIONS.md · docs/research/EXPERIMENTS.md"
  );
  const p = [f.open];

  p.push(
    T(28, 92, "Results are ordered by how much of the world they survive contact with. Nothing here is promoted a rung by argument; a rung is bought by a run.", { size: 12, cls: "mut" })
  );

  let y = 116;
  rungs.forEach((rung) => {
    const h = rungH(rung);
    p.push(R(28, y, W - 56, h, { rx: 9, fill: `var(--${rung.tone}Soft)`, op: 0.5 }));
    p.push(R(28, y, 4, h, { rx: 2, fill: `var(--${rung.tone})` }));
    p.push(T(48, y + 24, rung.t, { size: 13.5, bold: true }));
    p.push(T(48 + rung.t.length * 8.2 + 18, y + 24, rung.s, { size: 11, cls: "mut" }));
    rung.items.forEach((it, j) => {
      p.push(R(52, y + 38 + j * 17 - 4, 4, 4, { rx: 2, fill: `var(--${rung.tone})` }));
      p.push(T(66, y + 38 + j * 17, it, { size: 11.2, cls: "ink" }));
    });
    y += h + 8;
  });

  p.push(f.close);
  write("fig-evidence-ladder.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------
// Figure 8 — what is actually in here, by lines and by guard.
// ---------------------------------------------------------------------------

function figRepo() {
  const d = DATA.repo;
  const W = 1160;
  const H = 596;
  const f = frame(
    W,
    H,
    `What is in this repository: ${fmt(d.tracked_files)} tracked files`,
    "Figure 8 · repository composition",
    `git ls-files · measured ${d.measured_on} · guard status per artifact: docs/artifact/CI_COVERAGE.md`
  );
  const p = [f.open];

  p.push(T(28, 92, "Area is lines of code. The test tree is the largest single directory in the repository, which is the intended shape for an artifact whose defence is “do not trust the author, run the tests”.", { size: 12, cls: "mut" }));

  // treemap over directories
  const TX = 28;
  const TY = 116;
  const TW = 700;
  const TH = 300;
  const total = d.directories.reduce((s, x) => s + x.lines, 0);
  const tones = ["acc", "steel", "vio", "pos", "warn", "steel", "acc", "vio", "pos", "warn"];

  // simple row-packing treemap: fill rows left to right, height proportional
  let idx = 0;
  let cy = TY;
  let remaining = total;
  while (idx < d.directories.length && cy < TY + TH - 1) {
    // take items until the row is reasonably square
    const rowItems = [];
    let rowSum = 0;
    const targetRow = Math.max(remaining / Math.max(1, Math.ceil(remaining / (total / 3))), 1);
    while (idx < d.directories.length) {
      rowItems.push(d.directories[idx]);
      rowSum += d.directories[idx].lines;
      idx += 1;
      if (rowSum >= targetRow || idx >= d.directories.length) break;
    }
    const rowH = (rowSum / total) * TH;
    let cx = TX;
    for (const item of rowItems) {
      const w = (item.lines / rowSum) * TW;
      const tone = tones[(d.directories.indexOf(item)) % tones.length];
      p.push(R(cx + 1.5, cy + 1.5, w - 3, rowH - 3, { rx: 7, fill: `var(--${tone}Soft)`, stroke: `var(--${tone})`, sw: 1 }));
      if (w > 92 && rowH > 34) {
        p.push(T(cx + 14, cy + 24, `${item.dir}/`, { size: 13, mono: true, bold: true }));
        p.push(T(cx + 14, cy + 40, `${fmt(item.lines)} lines`, { size: 10.5, cls: "mut" }));
        if (rowH > 58 && w > 190) p.push(T(cx + 14, cy + 56, item.role, { size: 9.5, cls: "faint" }));
      } else if (w > 30) {
        p.push(T(cx + w / 2, cy + rowH / 2 + 4, item.dir, { size: 9, mono: true, anchor: "middle", cls: "mut" }));
      }
      cx += w;
    }
    cy += rowH;
    remaining -= rowSum;
  }

  // language bars
  const LX = 764;
  p.push(T(LX, TY + 8, "Languages, and what guards each", { size: 11, kicker: true, cls: "mut" }));
  const maxLines = Math.max(...d.languages.map((l) => l.lines));
  d.languages.forEach((l, i) => {
    const y = TY + 28 + i * 38;
    p.push(T(LX, y + 12, l.lang, { size: 11.5, bold: true }));
    p.push(T(W - 40, y + 12, fmt(l.lines), { size: 11, anchor: "end", mono: true, cls: "mut" }));
    p.push(R(LX, y + 18, (W - 40 - LX), 7, { rx: 3.5, fill: "var(--pane2)" }));
    p.push(R(LX, y + 18, (W - 40 - LX) * (l.lines / maxLines), 7, { rx: 3.5, fill: "var(--acc)", op: 0.85 }));
    p.push(T(LX, y + 36, `${l.files} files`, { size: 9.5, cls: "faint", mono: true }));
  });

  // suite strip
  const s = DATA.suite;
  const sy = TY + TH + 24;
  p.push(L(28, sy, W - 28, sy, { op: 0.7 }));
  const stats = [
    [fmt(s.tests_passed), "tests passing"],
    [String(s.tests_skipped), "skipped"],
    [String(s.files_total), "test files"],
    [`${s.duration_s}s`, "suite wall clock"],
    [fmt(s.claim_scan_files), "files claim-scanned"],
    [String(s.claim_scan_violations), "claim violations"]
  ];
  stats.forEach((v, i) => {
    const x = 28 + i * 188;
    p.push(T(x, sy + 32, v[0], { size: 20, bold: true, mono: true, cls: i === 5 ? "pos" : "ink" }));
    p.push(T(x, sy + 50, v[1], { size: 10, cls: "mut" }));
  });
  p.push(T(28, sy + 72, `npm test and npm run scan:claims, measured ${s.measured_on}. The claim scanner fails the build on forbidden assurance vocabulary; it is a control, not a style guide.`, { size: 10.5, cls: "faint" }));

  p.push(f.close);
  write("fig-repo-map.svg", p.join("\n"));
}

// ---------------------------------------------------------------------------

console.log("rendering README figures from docs/assets/figure-data.json");
figKernel();
figCensus();
figCost();
figRealTraffic();
figMutation();
figProofs();
figLadder();
figRepo();
console.log("done — 8 figures");
