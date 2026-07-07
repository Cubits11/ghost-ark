import { ConsentState } from "../policy/decisions";
import { MemoryTier } from "./tiers";

export function hasRestrictedMemoryConsent(tier: MemoryTier, consentState: ConsentState): boolean {
  return tier !== "RESTRICTED" || consentState === "granted";
}

export function restrictedConsentReason(tier: MemoryTier, consentState: ConsentState): string | undefined {
  if (hasRestrictedMemoryConsent(tier, consentState)) {
    return undefined;
  }
  return `restricted memory requires explicit consent; observed consent state ${consentState}`;
}
