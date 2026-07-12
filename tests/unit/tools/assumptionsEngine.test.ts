import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyze,
  type AssumptionRegistry,
  type ModuleDescriptor,
  parseModule,
} from "../../../tools/assumptions/check-assumptions.mjs";

const registry: AssumptionRegistry = {
  schema_version: "ghostark.assumptions.registry.v1",
  assumptions: {
    A_HELD: { status: "HELD", rationale: "held" },
    A_PARTIAL: { status: "PARTIAL", rationale: "partial" },
    A_UNMET: { status: "UNMET", rationale: "unmet" },
  },
};

function mod(partial: Partial<ModuleDescriptor> & { absPath: string; maturity: ModuleDescriptor["maturity"] }): ModuleDescriptor {
  return { assumptions: [], imports: [], ...partial };
}

describe("assumptions engine — parseModule", () => {
  it("extracts MATURITY, ASSUMPTIONS, and relative imports", () => {
    const src = [
      'export const MATURITY: Maturity = "PRODUCTION";',
      'export const ASSUMPTIONS: AssumptionId[] = ["A_HELD", "A_PARTIAL"];',
      'import { x } from "./dep";',
      'import { y } from "aws-cdk-lib";',
    ].join("\n");
    const parsed = parseModule("/repo/m.ts", src);
    expect(parsed?.maturity).toBe("PRODUCTION");
    expect(parsed?.assumptions).toEqual(["A_HELD", "A_PARTIAL"]);
    expect(parsed?.imports).toContain("./dep");
    expect(parsed?.imports).not.toContain("aws-cdk-lib");
  });

  it("returns null for an unannotated module", () => {
    expect(parseModule("/repo/x.ts", "export const foo = 1;")).toBeNull();
  });
});

describe("assumptions engine — lattice enforcement", () => {
  it("flags a PRODUCTION module resting on an UNMET assumption", () => {
    const { violations } = analyze([mod({ absPath: "/r/a.ts", maturity: "PRODUCTION", assumptions: ["A_UNMET"] })], registry);
    expect(violations.some((v) => v.kind === "maturity_overclaim")).toBe(true);
  });

  it("allows a RESEARCH module resting on a PARTIAL assumption", () => {
    const { violations } = analyze([mod({ absPath: "/r/a.ts", maturity: "RESEARCH", assumptions: ["A_PARTIAL"] })], registry);
    expect(violations).toHaveLength(0);
  });

  it("flags a PRODUCTION module that imports a RESEARCH module (dependency cap)", () => {
    const { violations } = analyze(
      [
        mod({ absPath: "/r/a.ts", maturity: "PRODUCTION", imports: ["./b"] }),
        mod({ absPath: "/r/b.ts", maturity: "RESEARCH" }),
      ],
      registry,
    );
    expect(violations.some((v) => v.module === "/r/a.ts" && v.kind === "maturity_overclaim")).toBe(true);
  });

  it("propagates assumptions transitively (A -> B -> C with an UNMET assumption)", () => {
    const { violations, results } = analyze(
      [
        mod({ absPath: "/r/a.ts", maturity: "PRODUCTION", imports: ["./b"] }),
        mod({ absPath: "/r/b.ts", maturity: "PRODUCTION", imports: ["./c"] }),
        mod({ absPath: "/r/c.ts", maturity: "PRODUCTION", assumptions: ["A_UNMET"] }),
      ],
      registry,
    );
    const a = results.find((r) => r.module === "/r/a.ts");
    expect(a?.transitiveAssumptions).toContain("A_UNMET");
    expect(a?.ok).toBe(false);
    expect(violations.some((v) => v.module === "/r/a.ts")).toBe(true);
  });

  it("flags a reference to an assumption absent from the registry", () => {
    const { violations } = analyze([mod({ absPath: "/r/a.ts", maturity: "RESEARCH", assumptions: ["A_TYPO"] })], registry);
    expect(violations.some((v) => v.kind === "unknown_assumption")).toBe(true);
  });

  it("passes a fully consistent module set", () => {
    const { violations } = analyze(
      [
        mod({ absPath: "/r/led.ts", maturity: "SYNTH_ONLY", assumptions: ["A_UNMET"] }),
        mod({ absPath: "/r/auth.ts", maturity: "RESEARCH", assumptions: ["A_PARTIAL", "A_HELD"] }),
      ],
      registry,
    );
    expect(violations).toHaveLength(0);
  });
});

describe("assumptions engine — real repository is honest-green", () => {
  it("npm run assumptions exits 0 on the current tree", () => {
    const scriptPath = join(process.cwd(), "tools/assumptions/check-assumptions.mjs");
    const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No assumption lattice violations");
  });
});
