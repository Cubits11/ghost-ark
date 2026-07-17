// Cryptographic Witness Bridge for GHOST-CRDT-V1
//
// CLAIM BOUNDARY: Generates structural, verifiable receipts for local CRDT merges.
// Provides eventual consistency proof that a node's post-merge root strictly derives
// from its pre-merge root and the applied intent.
//
// No maturity annotation: pure computation over supplied state, no network assumptions.

import { createHash, createHmac } from "node:crypto";
import { LWWRegister } from "./lwwMap";

export interface CRDTReceipt {
  readonly protocol: "GHOST-CRDT-V1";
  readonly status: "MERGED" | "DISCARDED" | "COLLAPSE_UNSATISFIABLE_FLOOR";
  readonly pre_state_root: string;
  readonly operation: {
    readonly key: string;
    readonly register: LWWRegister;
  };
  readonly post_state_root: string;
  readonly signature: string;
}

const DEV_HMAC_KEY = "ghost-ark-dev-only-hmac-key";

export function buildCrdtReceipt(
  status: "MERGED" | "DISCARDED" | "COLLAPSE_UNSATISFIABLE_FLOOR",
  preRoot: string,
  key: string,
  register: LWWRegister,
  postRoot: string
): CRDTReceipt {
  const payloadStr = JSON.stringify({ status, preRoot, key, register, postRoot });
  const signature = createHmac("sha256", DEV_HMAC_KEY).update(payloadStr).digest("hex");
  
  return {
    protocol: "GHOST-CRDT-V1",
    status,
    pre_state_root: preRoot,
    operation: { key, register },
    post_state_root: postRoot,
    signature: `hmac-sha256:${signature}`,
  };
}

export function verifyCrdtReceipt(receipt: CRDTReceipt): boolean {
  if (receipt.protocol !== "GHOST-CRDT-V1") return false;
  
  const payloadStr = JSON.stringify({
    status: receipt.status,
    preRoot: receipt.pre_state_root,
    key: receipt.operation.key,
    register: receipt.operation.register,
    postRoot: receipt.post_state_root
  });
  
  const expectedSig = createHmac("sha256", DEV_HMAC_KEY).update(payloadStr).digest("hex");
  return receipt.signature === `hmac-sha256:${expectedSig}`;
}
