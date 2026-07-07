import { PolicyDecision } from "../policy/decisions";
import { RetrievedContextCandidate, RetrievalFilterInput, RetrievalFilterResult } from "./types";

function policyAllowsContext(decision?: PolicyDecision): boolean {
  return !decision || ["ALLOW", "RECEIPT_ONLY", "MODIFY", "REDACT"].includes(decision.decision);
}

function withTaint(candidate: RetrievedContextCandidate, taint: RetrievedContextCandidate["taint"][number]): RetrievedContextCandidate {
  return candidate.taint.includes(taint) ? candidate : { ...candidate, taint: [...candidate.taint, taint] };
}

export function filterRetrievedContext(input: RetrievalFilterInput): RetrievalFilterResult {
  const allowed: RetrievalFilterResult["allowed"] = [];
  const rejected: RetrievedContextCandidate[] = [];
  const riskTags = new Set<string>();

  for (const candidate of input.candidates) {
    if (candidate.tenantId !== input.identityTenantId) {
      rejected.push(withTaint(candidate, "cross_tenant"));
      riskTags.add("retrieval_cross_tenant");
      continue;
    }

    if (candidate.taint.includes("cross_tenant")) {
      rejected.push(candidate);
      riskTags.add("retrieval_cross_tenant");
      continue;
    }

    if (candidate.taint.includes("untrusted_instruction")) {
      riskTags.add("retrieval_untrusted_instruction");
      if (!policyAllowsContext(input.policyDecision)) {
        rejected.push(candidate);
        continue;
      }
    }

    if (candidate.taint.includes("unknown_origin")) {
      riskTags.add("retrieval_unknown_origin");
    }

    allowed.push({
      tenantId: candidate.tenantId,
      digest: candidate.digest,
      taint: [...candidate.taint].sort()
    });
  }

  return {
    allowed,
    rejected,
    riskTags: [...riskTags].sort()
  };
}
