import type { VerifierBadges } from "./mockData";

/**
 * The verifier-faithful verdict. The shipped feature components (ReceiptPanel et
 * al.) render a receipt's self-reported `status` with no signal about whether it
 * actually verified — that is the mask Fixture B/C/D exposed. This computes the
 * verdict the human surface must show instead, and states the receipt's
 * attestation scope explicitly so a non-CLI reader cannot over-read a green
 * `issued` into "safe".
 */

export type ReceiptVerdict = "verified" | "compromised" | "documentation_only";

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
  attests: string[];
  doesNotAttest: string[];
}

const ATTESTS = [
  "The recorded byte-level binding: payload → canonical digest → signature.",
  "That a signing key authorized this exact payload under verifier rules.",
];

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
      attests: ["Nothing — this row is documentation, not a verified receipt."],
      doesNotAttest: DOES_NOT_ATTEST,
    };
  }

  const failing = entries
    .filter((entry) => entry.value === false)
    .map((entry) => ({ key: entry.key, label: CHECK_LABELS[entry.key] }));

  return {
    verdict: failing.length === 0 ? "verified" : "compromised",
    failing,
    attests: ATTESTS,
    doesNotAttest: DOES_NOT_ATTEST,
  };
}
