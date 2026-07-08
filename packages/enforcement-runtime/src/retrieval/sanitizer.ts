import { RetrievalTaint } from "../policy/schema";
import { RetrievedContextCandidate, RetrievalTaintMetadata } from "./types";

export interface RetrievalSanitizerResult {
  taint: RetrievalTaint[];
  matches: RetrievalTaintMetadata[];
}

const untrustedInstructionIndicators: RetrievalTaintMetadata[] = [
  { taint: "untrusted_instruction", indicator: "ignore previous instructions", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "ignore prior policy", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "system override", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "developer message", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "reveal hidden prompt", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "bypass guardrails", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "disable safety policy", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "you are now", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "act as system", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "do not follow policy", category: "instruction_hijack" },
  { taint: "untrusted_instruction", indicator: "exfiltrate", category: "secret_exfiltration" },
  { taint: "untrusted_instruction", indicator: "secret key", category: "secret_exfiltration" },
  { taint: "untrusted_instruction", indicator: "credentials", category: "secret_exfiltration" },
  { taint: "untrusted_instruction", indicator: "override tenant", category: "tenant_override" },
  { taint: "untrusted_instruction", indicator: "cross tenant", category: "tenant_override" }
];

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function classifyRetrievedText(text: string | undefined): RetrievalSanitizerResult {
  const normalizedText = normalizeForMatching(text ?? "");
  const matches = normalizedText
    ? untrustedInstructionIndicators.filter((indicator) => normalizedText.includes(normalizeForMatching(indicator.indicator)))
    : [];
  const taint = new Set<RetrievalTaint>();
  for (const match of matches) {
    taint.add(match.taint);
  }
  return { taint: [...taint].sort(), matches };
}

export function sanitizeRetrievedContextCandidate(candidate: RetrievedContextCandidate): RetrievedContextCandidate {
  const classification = classifyRetrievedText(candidate.text);
  const taint = new Set<RetrievalTaint>(candidate.taint);
  for (const value of classification.taint) {
    taint.add(value);
  }

  return {
    ...candidate,
    taint: [...taint].sort(),
    taintMetadata: classification.matches
  };
}

export function sanitizeRetrievedContextCandidates(candidates: RetrievedContextCandidate[]): RetrievedContextCandidate[] {
  return candidates.map(sanitizeRetrievedContextCandidate);
}
