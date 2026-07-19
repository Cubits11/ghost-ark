import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scannerPath = join(
  process.cwd(),
  "tools/research/check-forbidden-claims.mjs",
);

const tempDirs: string[] = [];

function phrase(...parts: string[]): string {
  return parts.join(" ");
}

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ghost-ark-claims-"));
  tempDirs.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string, text: string): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, "utf8");
}

function runScanner(root: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [scannerPath, root], {
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("forbidden claim scanner", () => {
  const blockedCases = [
    {
      name: "broad ai-safety proof wording",
      line: phrase("Ghost-Ark", "proves", "AI", "safety."),
      ruleId: "ai-safety-proof",
    },
    {
      name: "model-safety guarantee wording",
      line: phrase("Ghost-Ark", "guarantees", "model", "safety."),
      ruleId: "model-safety-guarantee",
    },
    {
      name: "absolute trust wording",
      line: phrase("Ghost-Ark is", "fully", "trustless."),
      ruleId: "fully-trustless",
    },
    {
      name: "SOC2 compliance wording",
      line: phrase("Ghost-Ark is", "SOC2", "compliant."),
      ruleId: "compliance-certification",
    },
    {
      name: "live proof wording",
      line: phrase(
        "Ghost-Ark executes live",
        "zero-knowledge",
        "proofs.",
      ),
      ruleId: ["zk", "execution", "claim"].join("-"),
    },
    {
      name: "production enterprise readiness wording",
      line: phrase(
        "Ghost-Ark is",
        "production-ready",
        "enterprise",
        "infrastructure.",
      ),
      ruleId: "production-ready",
    },
    {
      name: "hyphenated production enterprise readiness wording",
      line: phrase(
        "Ghost-Ark is",
        "production ready",
        "enterprise",
        "infrastructure.",
      ),
      ruleId: "production-ready",
    },
    {
      name: "enterprise readiness wording",
      line: phrase("Ghost-Ark is", "enterprise", "ready."),
      ruleId: "enterprise-ready",
    },
    {
      name: "compliance certification wording",
      line: phrase("Ghost-Ark is", "compliance", "certified."),
      ruleId: "compliance-certification",
    },
    {
      name: "semantic truth overclaim wording",
      line: phrase("Ghost-Ark provides a", "truthfulness", "guarantee."),
      ruleId: "truthfulness-guarantee",
    },
    {
      name: "semantic correctness proof wording",
      line: phrase("Ghost-Ark proves", "semantic", "correctness."),
      ruleId: "truthfulness-guarantee",
    },
    {
      name: "absolute risk elimination wording",
      line: phrase("Ghost-Ark", "eliminates", "all", "risk."),
      ruleId: "risk-elimination",
    },
    {
      name: "hardware isolation wording",
      line: phrase("Ghost-Ark provides", "hardware-enforced", "isolation."),
      ruleId: "hardware-enforced-isolation",
    },
    {
      name: "alignment guarantee wording",
      line: phrase("Ghost-Ark can", "guarantee", "alignment."),
      ruleId: "alignment-guarantee",
    },
    {
      name: "pseudo-physics wording",
      line: phrase("Bounded by strict", "Holographic", "RAM", "isolations."),
      ruleId: "pseudo-physics",
    },
    {
      name: "fabricated empiricism wording",
      line: phrase("Limits are", "hardware-bounded", "by PCI-e write barriers."),
      ruleId: "fabricated-empiricism",
    },
    {
      name: "thermodynamic safety wording",
      line: phrase("Ghost-Ark enforces a", "thermodynamic", "iteration budget."),
      ruleId: "thermodynamic-safety-claim",
    },
    {
      name: "absolute review status wording",
      line: phrase("Review status is", "immutably", "sound", "and green."),
      ruleId: "absolute-review-status",
    },
  ];

  for (const testCase of blockedCases) {
    it(`rejects ${testCase.name}`, () => {
      const root = makeTempRoot();
      writeFixture(root, "docs/example.md", testCase.line);

      const result = runScanner(root);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(testCase.ruleId);
      expect(result.stderr).toContain("docs/example.md:1");
    });
  }

  const acceptedCases = [
    phrase("Ghost-Ark does not", "prove", "AI", "safety."),
    phrase("Ghost-Ark does not", "guarantee", "model", "safety."),
    phrase(
      "Ghost-Ark defines a schema-only zk receipt interface and does not execute live",
      "zk",
      "proofs.",
    ),
    phrase(
      "This is an algorithmic overhead result, not a universal",
      "thermodynamic",
      "law.",
    ),
    phrase(
      "Ghost-Ark must not claim",
      "hardware-bounded",
      "isolation without live evidence.",
    ),
  ];

  for (const line of acceptedCases) {
    it("accepts explicit non-claim wording", () => {
      const root = makeTempRoot();
      writeFixture(root, "docs/non-claim.md", line);

      const result = runScanner(root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("No forbidden assurance overclaims");
    });
  }

  it("rejects overclaims inside JSON and YAML files", () => {
    const root = makeTempRoot();

    writeFixture(
      root,
      "examples/claims.json",
      JSON.stringify(
        {
          publicClaim: phrase(
            "Ghost-Ark is",
            "production-ready",
            "enterprise",
            "infrastructure.",
          ),
        },
        null,
        2,
      ),
    );

    writeFixture(
      root,
      "docs/claims.yml",
      [
        "claim:",
        `  text: "${phrase("Ghost-Ark", "eliminates", "all", "risk.")}"`,
      ].join("\n"),
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("examples/claims.json");
    expect(result.stderr).toContain("docs/claims.yml");
    expect(result.stderr).toContain("production-ready");
    expect(result.stderr).toContain("risk-elimination");
  });

  it("rejects overclaims inside TypeScript comments and constants", () => {
    const root = makeTempRoot();
    writeFixture(
      root,
      "src/sample.ts",
      [
        `// ${phrase("Ghost-Ark", "proves", "AI", "safety.")}`,
        `export const claim = ${JSON.stringify(
          phrase("Ghost-Ark is", "fully", "trustless."),
        )};`,
      ].join("\n"),
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/sample.ts:1");
    expect(result.stderr).toContain("src/sample.ts:2");
    expect(result.stderr).toContain("ai-safety-proof");
    expect(result.stderr).toContain("fully-trustless");
  });

  it("uses exact policy-document allowlists only", () => {
    const root = makeTempRoot();
    const blockedLine = phrase("Ghost-Ark", "proves", "AI", "safety.");

    writeFixture(
      root,
      "docs/research/THREAT_MODEL_FRONTIER.md",
      blockedLine,
    );

    expect(runScanner(root).status).toBe(0);

    writeFixture(root, "docs/research/not-allowlisted.md", blockedLine);
    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/research/not-allowlisted.md:1");
    expect(result.stderr).not.toContain("THREAT_MODEL_FRONTIER.md");
  });

  it("scans Makefile status banners (extensionless build orchestration)", () => {
    const root = makeTempRoot();
    writeFixture(
      root,
      "Makefile",
      'status:\n\t@echo "REVIEW STATUS: IMMUTABLY SOUND & GREEN."\n',
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("absolute-review-status");
    expect(result.stderr).toContain("Makefile:2");
  });

  it("scans shell scripts", () => {
    const root = makeTempRoot();
    writeFixture(
      root,
      "scripts/report.sh",
      'echo "Ghost-Ark is production-ready."\n',
    );

    const result = runScanner(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("production-ready");
    expect(result.stderr).toContain("scripts/report.sh:1");
  });

  it("scans Dockerfiles by basename prefix", () => {
    const root = makeTempRoot();
    writeFixture(root, "Dockerfile.reviewer", "# Ghost-Ark is production-ready\n");

    expect(runScanner(root).status).toBe(1);
  });

  it("skips generated artifacts/ output", () => {
    const root = makeTempRoot();
    writeFixture(
      root,
      "artifacts/report.md",
      phrase("Ghost-Ark", "proves", "AI", "safety."),
    );

    expect(runScanner(root).status).toBe(0);
  });
});
