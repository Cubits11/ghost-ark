import { PolicyDecision } from "../policy/decisions";
import { RetrievedContextForPolicy, RetrievalTaint } from "../policy/schema";

export interface RetrievedContextCandidate {
  tenantId: string;
  digest: string;
  text?: string;
  taint: RetrievalTaint[];
  taintMetadata?: RetrievalTaintMetadata[];
  source?: string;
}

export interface RetrievalTaintMetadata {
  taint: Extract<RetrievalTaint, "untrusted_instruction">;
  indicator: string;
  category: "instruction_hijack" | "secret_exfiltration" | "tenant_override";
}

export interface RetrievalProvider {
  retrieve(input: {
    tenantId: string;
    userId: string;
    queryText: string;
    requestId: string;
  }): Promise<RetrievedContextCandidate[]>;
}

export interface RetrievalFilterInput {
  identityTenantId: string;
  candidates: RetrievedContextCandidate[];
  policyDecision?: PolicyDecision;
}

export interface RetrievalFilterResult {
  allowed: RetrievedContextForPolicy[];
  rejected: RetrievedContextCandidate[];
  sanitized: RetrievedContextCandidate[];
  riskTags: string[];
}
