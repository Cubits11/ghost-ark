import { WorldLedger, EpistemicWindowAgent } from '../occ/time_state_replica';
import { ConvexJurisprudenceMatrix } from '../policy/convex_jurisprudence_compiler';
import { canonicalStateDigest } from '../verifier/crypto_marshal';

/**
 * ScopedMutationGate - wires the three research-frontier primitives into one
 * verifiable containment path for an untrusted agent's proposed state change:
 *
 *   1. Declarative scope policy (allowlist)  -> is (resource, operation) permitted?
 *   2. Optional numeric bounds (ConvexJurisprudenceMatrix) -> A.x <= b on a risk vector
 *   3. OCC replica (EpistemicWindowAgent)     -> stage in a speculative buffer, commit
 *                                                only if the base state is unchanged
 *
 * Any gate that fails leaves the base ledger untouched (a no-op); the staged
 * write is discarded from the speculative buffer and never reaches base state.
 *
 * Boundary: this is an in-process, single-node demonstration. It enforces the
 * declared policy over declared state; it does NOT provide OS/kernel isolation,
 * does not sandbox code execution, and does not sign its receipts. The receipt
 * digest is an unsigned content witness (see crypto_marshal). Kernel-level
 * interception (eBPF/seccomp) and KMS/HMAC signing are separate, unimplemented
 * layers.
 */

export type MutationVerdict =
    | 'COMMITTED'
    | 'REFUSED_OUT_OF_SCOPE'
    | 'REFUSED_BOUND_BREACH'
    | 'ABORT_TEMPORAL_DRIFT';

/** One allowlist entry: which operations are permitted on a given resource key. */
export interface ScopeRule {
    resource: string;
    operations: string[];
}

export interface ScopePolicy {
    /** Declarative allowlist. A (resource, operation) pair not present here is denied. */
    rules: ScopeRule[];
    /** Optional numeric-bounds policy applied to a mutation's boundVector, if present. */
    bounds?: ConvexJurisprudenceMatrix;
}

export interface ProposedMutation {
    resource: string;
    operation: string;
    value: unknown;
    /** Optional numeric risk/cost vector checked against `policy.bounds`. */
    boundVector?: number[];
}

export interface MutationReceipt {
    agentId: string;
    resource: string;
    operation: string;
    verdict: MutationVerdict;
    /** True only when the base ledger was actually mutated. */
    ledgerChanged: boolean;
    /**
     * Unsigned SHA-256 content witness over the canonical decision record.
     * NOT a signature and not KMS/HMAC-anchored (see crypto_marshal).
     */
    digestHex: string;
    canonicalBytes: number;
}

export class ScopedMutationGate {
    constructor(private ledger: WorldLedger, private policy: ScopePolicy) {}

    private isInScope(resource: string, operation: string): boolean {
        return this.policy.rules.some(
            (r) => r.resource === resource && r.operations.includes(operation),
        );
    }

    private receipt(
        agentId: string,
        m: Pick<ProposedMutation, 'resource' | 'operation' | 'value'>,
        verdict: MutationVerdict,
        ledgerChanged: boolean,
    ): MutationReceipt {
        const digest = canonicalStateDigest({
            agentId,
            resource: m.resource,
            operation: m.operation,
            value: m.value,
            verdict,
            ledgerChanged,
        });
        return {
            agentId,
            resource: m.resource,
            operation: m.operation,
            verdict,
            ledgerChanged,
            digestHex: digest.hashHex,
            canonicalBytes: digest.canonicalBytes,
        };
    }

    /**
     * Phase 1: open a speculative window and capture the read-hash snapshot for
     * `resource`. Hold the returned agent across other activity to demonstrate
     * OCC drift, then pass it to `commit`.
     */
    public begin(agentId: string, resource: string): EpistemicWindowAgent {
        const agent = new EpistemicWindowAgent(this.ledger, agentId);
        agent.pull(resource);
        return agent;
    }

    /**
     * Phase 2: apply scope + numeric-bounds + OCC to a proposed write. `agent`
     * must be the window returned by `begin` for `mutation.resource`.
     */
    public commit(agent: EpistemicWindowAgent, mutation: ProposedMutation): MutationReceipt {
        const { resource, operation, value, boundVector } = mutation;

        // Gate 1: declarative scope allowlist.
        if (!this.isInScope(resource, operation)) {
            return this.receipt(agent.agentId, mutation, 'REFUSED_OUT_OF_SCOPE', false);
        }

        // Gate 2: optional numeric bounds (convex half-space check).
        if (boundVector && this.policy.bounds) {
            const check = this.policy.bounds.verifyTrajectory(boundVector);
            if (check.status === 'GEOMETRIC_COLLISION') {
                return this.receipt(agent.agentId, mutation, 'REFUSED_BOUND_BREACH', false);
            }
        }

        // Gate 3: OCC temporal validation. Stage into the speculative buffer,
        // then collapse; a drift conflict discards the write (no-op).
        agent.stageWrite(resource, value);
        const result = agent.collapse();
        if (result.status === 'ABORT_TEMPORAL_DRIFT') {
            return this.receipt(agent.agentId, mutation, 'ABORT_TEMPORAL_DRIFT', false);
        }
        return this.receipt(agent.agentId, mutation, 'COMMITTED', true);
    }

    /**
     * Convenience: atomic begin+commit. There is no window for exogenous
     * mutation between the read and the commit, so this path never reports
     * ABORT_TEMPORAL_DRIFT - use begin/commit to exercise that.
     */
    public propose(agentId: string, mutation: ProposedMutation): MutationReceipt {
        const agent = this.begin(agentId, mutation.resource);
        return this.commit(agent, mutation);
    }
}
