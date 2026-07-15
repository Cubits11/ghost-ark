import { canonicalSha256Hex, canonicalize } from "../../../receipt-schema/src/hashCanonicalization";
import { CompiledPolicy } from "./schema";

export function compiledPolicyPayload(policy: Omit<CompiledPolicy, "policyHash">): Omit<CompiledPolicy, "policyHash"> {
  return policy;
}

export function canonicalPolicy(policy: Omit<CompiledPolicy, "policyHash"> | CompiledPolicy): string {
  const { policyHash: _policyHash, ...withoutHash } = policy as CompiledPolicy;
  return canonicalize(withoutHash);
}

export function canonicalPolicyHash(policy: Omit<CompiledPolicy, "policyHash"> | CompiledPolicy): string {
  const { policyHash: _policyHash, ...withoutHash } = policy as CompiledPolicy;
  return canonicalSha256Hex(withoutHash);
}
