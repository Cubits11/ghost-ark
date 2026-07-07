import { PolicyDecision } from "../policy/decisions";
import { RetrievedContextForPolicy, RetrievalTaint } from "../policy/schema";

export interface RetrievedContextCandidate {
  tenantId: string;
  digest: string;
  text?: string;
  taint: RetrievalTaint[];
  source?: string;
}

export interface RetrievalFilterInput {
  identityTenantId: string;
  candidates: RetrievedContextCandidate[];
  policyDecision?: PolicyDecision;
}

export interface RetrievalFilterResult {
  allowed: RetrievedContextForPolicy[];
  rejected: RetrievedContextCandidate[];
  riskTags: string[];
}
