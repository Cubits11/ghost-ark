import type { VerifierBadges } from "./mockData";

/**
 * The verifier-faithful verdict. The shipped feature components (ReceiptPanel et
 * al.) render a receipt's self-reported `status` with no signal about whether it
 * actually verified — that is the mask Fixture B/C/D exposed. This computes the
 * verdict the human surface must show instead, and states the receipt's
 * attestation scope explicitly so a non-CLI reader cannot over-read a green
 * `issued` into "safe".
 *
 * Verdict discipline (hardened after adversarial review):
 *  - `verified` requires EVERY critical check to be exactly `true`. A `null`
 *    (not evaluated) critical never counts as a pass.
 *  - `compromised` (any critical `false`) attests NOTHING — it must not repeat
 *    the positive "a signing key authorized this payload" line, because that is
 *    exactly the authority a compromised manifest/epoch forges.
 *  - `incomplete` (some critical `null`, none `false`) is distinct from
 *    `verified`: checks were not run, so no "all checks passed" claim is made.
 *  - `documentation_only` (all critical `null`) attests nothing.
 */

export type ReceiptVerdict = "verified" | "compromised" | "incomplete" | "documentation_only";

const CRITICAL_CHECKS: Array<keyof VerifierBadges> = [
  "signatureValid",
  "digestRecomputed",
  "merklePathValid",
  "keyIdImmutable",
  "manifestAuthenticated",
  "epochValid",
  "timeAnchored",
];

const CHECK_LABELS: Record<keyof VerifierBadges, string> = {
  digestRecomputed: "Digest recomputed",
  signatureValid: "Signature valid",
  merklePathValid: "Merkle path valid",
  keyIdImmutable: "Key ID immutable",
  manifestAuthenticated: "Manifest authenticated",
  epochValid: "Epoch valid",
  timeAnchored: "Time externally anchored",
};

export interface FailingCheck {
  key: keyof VerifierBadges;
  label: string;
}

export interface VerdictResult {
  verdict: ReceiptVerdict;
  failing: FailingCheck[];
  /** Checks that were present and passed but do not yet make the receipt verified. */
  unevaluated: FailingCheck[];
  attests: string[];
  doesNotAttest: string[];
}

const ATTESTS_VERIFIED = [
  "The recorded byte-level binding: payload → canonical digest → signature.",
  "That a signing key authorized this exact payload under verifier rules.",
];

const ATTESTS_COMPROMISED = [
  "Nothing can be relied upon: a critical check failed. The recorded binding — including whether any key legitimately authorized this payload — is not established.",
];

const ATTESTS_INCOMPLETE = [
  "Only the checks that were actually recomputed. One or more critical checks were not evaluated, so this receipt is not verified.",
];

const ATTESTS_DOC_ONLY = ["Nothing — this row is documentation, not a verified receipt."];

const DOES_NOT_ATTEST = [
  "That the model output is safe, true, or benign.",
  "That the input was not a prompt injection or jailbreak.",
  "That deployment, compliance, or key-custody posture is adequate.",
];

export function evaluateReceiptVerdict(badges: VerifierBadges): VerdictResult {
  const entries = CRITICAL_CHECKS.map((key) => ({ key, value: badges[key] }));
  const allNull = entries.every((entry) => entry.value === null);

  if (allNull) {
    return {
      verdict: "documentation_only",
      failing: [],
      unevaluated: [],
      attests: ATTESTS_DOC_ONLY,
      doesNotAttest: DOES_NOT_ATTEST,
    };
  }

  const failing = entries
    .filter((entry) => entry.value === false)
    .map((entry) => ({ key: entry.key, label: CHECK_LABELS[entry.key] }));

  if (failing.length > 0) {
    return {
      verdict: "compromised",
      failing,
      unevaluated: [],
      attests: ATTESTS_COMPROMISED,
      doesNotAttest: DOES_NOT_ATTEST,
    };
  }

  const unevaluated = entries
    .filter((entry) => entry.value === null)
    .map((entry) => ({ key: entry.key, label: CHECK_LABELS[entry.key] }));

  if (unevaluated.length > 0) {
    return {
      verdict: "incomplete",
      failing: [],
      unevaluated,
      attests: ATTESTS_INCOMPLETE,
      doesNotAttest: DOES_NOT_ATTEST,
    };
  }

  return {
    verdict: "verified",
    failing: [],
    unevaluated: [],
    attests: ATTESTS_VERIFIED,
    doesNotAttest: DOES_NOT_ATTEST,
  };
}
