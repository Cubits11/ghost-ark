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
      name: "live zero-knowledge execution wording",
      line: phrase("Ghost-Ark executes live", "zero-knowledge", "proofs."),
      ruleId: "live-zk-proof",
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
});
