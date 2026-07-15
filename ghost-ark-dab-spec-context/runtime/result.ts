import { PolicyDecision } from "../policy/decisions";

export type GovernedInvokeStatus =
  | "completed"
  | "refused_pre_model"
  | "refused_post_model"
  | "requires_consent"
  | "escalated"
  | "human_review"
  | "failed_closed";

export interface GovernedInvokeResult {
  schemaVersion: "ghost.governed_invoke.result.v1";
  requestId: string;
  tenantIdHash: string;
  userIdHash: string;
  modelId: string;
  status: GovernedInvokeStatus;
  responseText?: string;
  redacted?: boolean;
  decisionSummary: {
    preRetrieval?: PolicyDecision;
    preModel: PolicyDecision;
    postModel?: PolicyDecision;
    memoryWrite?: PolicyDecision;
  };
  memory: {
    attempted: boolean;
    written: boolean;
    reason: string;
  };
  receipt: {
    attempted: boolean;
    emitted: boolean;
    receiptId?: string;
    failureReason?: string;
  };
  /** Present only when the runtime was configured with a v2 receipt emitter. */
  receiptV2?: {
    attempted: boolean;
    emitted: boolean;
    receiptId?: string;
    failureReason?: string;
  };
  errors: string[];
}
