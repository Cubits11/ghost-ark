export const MATURITY_ORDER: string[];
export const STATUS_ORDER: string[];

export type Maturity = "PRODUCTION" | "RESEARCH" | "SYNTH_ONLY";
export type AssumptionStatus = "UNMET" | "PARTIAL" | "HELD";

export interface AssumptionRegistry {
  schema_version: string;
  assumptions: Record<string, { status: AssumptionStatus; rationale: string }>;
}

export interface ModuleDescriptor {
  absPath: string;
  maturity: Maturity;
  assumptions: string[];
  imports: string[];
}

export interface AnalyzeResult {
  results: Array<{
    module: string;
    declared: Maturity;
    effectiveCap: Maturity;
    transitiveAssumptions: string[];
    ok: boolean;
  }>;
  violations: Array<{ module: string; kind: string; detail: string }>;
}

export function loadRegistry(registryPath: string): AssumptionRegistry;
export function parseModule(absPath: string, text: string): ModuleDescriptor | null;
export function scanModules(roots: string[]): Map<string, ModuleDescriptor>;
export function analyze(moduleList: ModuleDescriptor[], registry: AssumptionRegistry): AnalyzeResult;
export function main(argv?: string[]): number;
