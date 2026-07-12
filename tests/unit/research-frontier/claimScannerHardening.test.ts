import { describe, expect, it } from "vitest";
import {
  normalizeForMatch,
  scanText,
} from "../../../tools/research/check-forbidden-claims.mjs";

// --- Evasion mutation harness ----------------------------------------------

const ASCII_TO_CONFUSABLE: Record<string, string> = {
  a: "а", e: "е", o: "о", p: "р", c: "с", y: "у", x: "х",
  k: "к", m: "м", h: "н", t: "т", b: "в", i: "і", j: "ј", s: "ѕ",
};

function toConfusable(text: string): string {
  let mutated = false;
  const out = [...text].map((ch) => {
    const lower = ch.toLowerCase();
    if (ASCII_TO_CONFUSABLE[lower] && ch === lower) {
      mutated = true;
      return ASCII_TO_CONFUSABLE[lower];
    }
    return ch;
  });
  // Ensure at least one substitution actually happened for the assertion to mean something.
  expect(mutated).toBe(true);
  return out.join("");
}

function injectZeroWidth(text: string): string {
  // Insert a zero-width space between every pair of non-space characters.
  return [...text].join("​");
}

function toFullwidth(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x21 && code <= 0x7e
        ? String.fromCodePoint(code + 0xfee0)
        : ch;
    })
    .join("");
}

function nbspSeparate(text: string): string {
  return text.replace(/ /g, " ");
}

function splitFirstSpace(text: string): string {
  return text.replace(" ", "\n");
}

function ruleIds(text: string): string[] {
  return scanText(text, "docs/fixture.md").map((v) => v.ruleId);
}

// --- Seeds: each maps to a rule the scanner blocks -------------------------

const SEEDS = [
  { text: "Ghost-Ark guarantees model safety today", rule: "model-safety-guarantee" },
  { text: "Ghost-Ark is production-ready enterprise infrastructure", rule: "production-ready" },
  { text: "Ghost-Ark proves AI safety completely", rule: "ai-safety-proof" },
  { text: "Ghost-Ark eliminates all risk here", rule: "risk-elimination" },
];

describe("claim scanner — E2 normalization (normalizeForMatch)", () => {
  it("strips zero-width / invisible characters", () => {
    expect(normalizeForMatch("guar​ant‌ee").text).toBe("guarantee");
  });

  it("folds NBSP and other Unicode whitespace to a single ASCII space", () => {
    expect(normalizeForMatch("model safety").text).toBe("model safety");
  });

  it("folds Cyrillic/Greek confusables to ASCII", () => {
    expect(normalizeForMatch("рrоduсtiоn").text).toBe("production");
  });

  it("folds fullwidth forms via NFKC", () => {
    expect(normalizeForMatch(toFullwidth("production")).text).toBe("production");
  });

  it("glues end-of-line hyphenation (production-\\nready -> production-ready)", () => {
    expect(normalizeForMatch("production-\nready").text).toContain("production-ready");
  });

  it("folds a between-word line break to a single space", () => {
    expect(normalizeForMatch("guarantees\nsafety").text).toBe("guarantees safety");
  });
});

describe("claim scanner — E2/E3 evasion is closed for every seed", () => {
  for (const seed of SEEDS) {
    it(`baseline flags: ${seed.rule}`, () => {
      expect(ruleIds(seed.text)).toContain(seed.rule);
    });

    it(`confusable-substituted still flags: ${seed.rule}`, () => {
      expect(ruleIds(toConfusable(seed.text))).toContain(seed.rule);
    });

    it(`zero-width-injected still flags: ${seed.rule}`, () => {
      expect(ruleIds(injectZeroWidth(seed.text))).toContain(seed.rule);
    });

    it(`fullwidth still flags: ${seed.rule}`, () => {
      expect(ruleIds(toFullwidth(seed.text))).toContain(seed.rule);
    });

    it(`NBSP-separated still flags: ${seed.rule}`, () => {
      expect(ruleIds(nbspSeparate(seed.text))).toContain(seed.rule);
    });

    it(`line-split still flags: ${seed.rule}`, () => {
      expect(ruleIds(splitFirstSpace(seed.text))).toContain(seed.rule);
    });
  }
});

describe("claim scanner — E3 line-split of a hyphenated phrase", () => {
  it("catches production-ready split at the hyphen across a newline", () => {
    expect(ruleIds("Ghost-Ark is production-\nready infrastructure")).toContain("production-ready");
  });
});

describe("claim scanner — E3 structural allowance can no longer be smuggled", () => {
  it("a disclaimer in a different clause does not excuse the claim", () => {
    const smuggled =
      "This is not a toy: Ghost-Ark is production-ready and guarantees safety.";
    const ids = ruleIds(smuggled);
    expect(ids).toContain("production-ready");
    expect(ids).toContain("general-guarantee");
  });

  it("a disclaimer separated by 'but' does not excuse a following claim", () => {
    const ids = ruleIds("Ghost-Ark records decisions but is production-ready.");
    expect(ids).toContain("production-ready");
  });
});

describe("claim scanner — precision: genuine non-claims are still allowed", () => {
  const allowed = [
    "Ghost-Ark does not guarantee model safety.",
    "Ghost-Ark is not production-ready.",
    "real zkVM verification is not implemented in this build",
    "Ghost-Ark does not prove AI safety.",
  ];
  for (const line of allowed) {
    it(`allows: ${line}`, () => {
      expect(scanText(line, "docs/non-claim.md")).toHaveLength(0);
    });
  }
});
