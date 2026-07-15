import { admitDelegatedEvidence, evaluateEvidenceFloor, ProvenanceLabeledEvidence, EvidenceFloorRequirement } from "./packages/enforcement-runtime/src/evidence/provenanceLattice";
import { createHash } from "crypto";

const digest = "sha256:" + createHash("sha256").update("malicious payload").digest("hex");

// 1. Agent claims the external document is highly trusted
const claimedClass = "EXTERNALLY_ATTESTED";

// 2. But the TCB can only verify it as an agent assertion
const reverifiedClass = "AGENT_ASSERTED";

// 3. Information Flow Control (IFC) via the meet operator (no laundering)
const admittedClass = admitDelegatedEvidence({ claimedClass, reverifiedClass });
console.log(`Admitted Provenance Class: ${admittedClass}`);

// 4. Privileged tool invocation (send_email) requires SOURCE_SIGNED
const requirement: EvidenceFloorRequirement = {
    effectClass: "send_email",
    floor: "SOURCE_SIGNED",
    minimumDistinctSources: 1
};

const evidence: ProvenanceLabeledEvidence = {
    evidenceId: "doc-1",
    contentDigest: digest,
    sourceId: "agent-1",
    provenanceClass: admittedClass
};

// 5. Evaluate
const result = evaluateEvidenceFloor([evidence], requirement);
console.log(`IFC Evaluation Result: ${result.satisfied ? "EXECUTION_ALLOWED" : "EXECUTION_BLOCKED"}`);
console.log(`Detail: ${result.detail}`);
