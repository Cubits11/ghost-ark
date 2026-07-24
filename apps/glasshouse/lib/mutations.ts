/**
 * Real, programmatic mutations of a Ghost-Ark receipt record, mapped to the
 * attack classes in docs/security/RECEIPT_ATTACK_CORPUS.md. Each mutation is a
 * pure transform that produces a receipt the verifier MUST reject at a named
 * step — the fail-closed demonstration behind Surface 2.
 *
 * HONESTY BOUNDARY on what is demonstrable here: every mutation below is a
 * TAMPER that verification catches. The corpus also contains a class
 * (MAL-016, "signature over a wrong canonical payload") that requires the
 * signing private key to synthesize a valid-but-lying signature; this file
 * does not hold that key and does not fabricate one, so that class is covered
 * only by the server-side corpus test, not here. Nothing is faked to appear
 * caught.
 */

export interface Mutation {
  id: string;
  label: string;
  /** The verifier step expected to catch it (informational; the verdict is authoritative). */
  expectedStep: string;
  /** Applies the tamper. May return a non-object for loader-level cases (e.g. malformed JSON). */
  apply: (receipt: any) => unknown;
  /** Optional verify-option override (e.g. an expected tenant/key that the mutation violates). */
  options?: { tenant?: string; expectedKeyId?: string };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function flipLastHexOrChar(s: string): string {
  const last = s.at(-1) ?? "0";
  const replacement = last === "a" ? "b" : "a";
  return s.slice(0, -1) + replacement;
}

export const MUTATIONS: Mutation[] = [
  {
    id: "CLEAN",
    label: "Unmutated receipt (baseline — must PASS)",
    expectedStep: "signature",
    apply: (r) => clone(r),
  },
  {
    id: "MAL-001",
    label: "Altered receipt id",
    expectedStep: "receipt_id",
    apply: (r) => {
      const m = clone(r);
      m.payload.receiptId = flipLastHexOrChar(m.payload.receiptId);
      return m;
    },
  },
  {
    id: "MAL-002",
    label: "Altered envelope digest",
    expectedStep: "digest",
    apply: (r) => {
      const m = clone(r);
      m.signature.digestSha256 = flipLastHexOrChar(m.signature.digestSha256);
      return m;
    },
  },
  {
    id: "MAL-003",
    label: "Altered signature (bit-flip)",
    expectedStep: "signature",
    apply: (r) => {
      const m = clone(r);
      // Flip one base64 char in the middle so it stays decodable but wrong.
      const sig = m.signature.signatureBase64 as string;
      const mid = Math.floor(sig.length / 2);
      const ch = sig[mid] === "A" ? "B" : "A";
      m.signature.signatureBase64 = sig.slice(0, mid) + ch + sig.slice(mid + 1);
      return m;
    },
  },
  {
    id: "MAL-005",
    label: "KMS alias key id (mutable identity)",
    expectedStep: "schema",
    apply: (r) => {
      const m = clone(r);
      m.signature.keyId = "alias/ghost-ark-signing"; // aliases are mutable → rejected pre-crypto
      return m;
    },
  },
  {
    id: "MAL-013",
    label: "Tenant slug mutation (attacker also updates the expectation)",
    expectedStep: "receipt_id",
    // The attacker rewrites tenantSlug AND presents a matching expectation, so
    // the consumer tenant check passes — isolating the cryptographic backstop:
    // the receiptId no longer hashes to the tampered payload.
    options: { tenant: "attacker-lab" },
    apply: (r) => {
      const m = clone(r);
      m.payload.tenantSlug = "attacker-lab";
      return m;
    },
  },
  {
    id: "MAL-014",
    label: "Cross-tenant expectation mismatch (consumer boundary)",
    expectedStep: "tenant",
    apply: (r) => clone(r),
    options: { tenant: "other-lab" }, // present acme-lab's receipt to a consumer expecting other-lab
  },
  {
    id: "MAL-021",
    label: "Execution timestamp mutation",
    expectedStep: "receipt_id",
    apply: (r) => {
      const m = clone(r);
      m.payload.issuedAt = "2030-01-01T00:00:00.000Z";
      return m;
    },
  },
  {
    id: "MAL-022",
    label: "Non-ASCII canonicalization mutation",
    expectedStep: "receipt_id",
    apply: (r) => {
      const m = clone(r);
      // Insert a combining/confusable char into a signed string field.
      m.payload.subject = { ...m.payload.subject, id: `${m.payload.subject?.id ?? "x"}́` };
      return m;
    },
  },
  {
    id: "MAL-024",
    label: "Malformed JSON (loader boundary)",
    expectedStep: "schema",
    apply: () => "{ this is not valid json",
  },
  {
    id: "MAL-025",
    label: "Missing signature block",
    expectedStep: "schema",
    apply: (r) => {
      const m = clone(r);
      delete m.signature;
      return m;
    },
  },
];

export function mutationById(id: string): Mutation | undefined {
  return MUTATIONS.find((m) => m.id === id);
}
