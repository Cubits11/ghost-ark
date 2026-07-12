export interface ForbiddenClaimViolation {
  filePath: string;
  lineNumber: number;
  line: string;
  ruleId: string;
  reason: string;
  suggestion: string;
}

export interface NormalizedText {
  /** Normalized matching form (confusables folded, invisibles stripped, whitespace/newlines collapsed). */
  text: string;
  /** Parallel array: source line (1-based) that produced each character of `text`. */
  lineFor: number[];
}

export function normalizeForMatch(rawText: string): NormalizedText;
export function scanText(rawText: string, filePath: string): ForbiddenClaimViolation[];
export function scanFile(filePath: string, rootDir?: string): ForbiddenClaimViolation[];
export function collectScannableFiles(rootDir: string): string[];
export function main(argv?: string[]): number;
