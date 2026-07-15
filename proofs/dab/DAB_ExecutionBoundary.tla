---------------- MODULE DAB_ExecutionBoundary ----------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS 
    Actors,       \* Set of all valid cryptographic identities
    Payloads,     \* Set of all possible execution bytes
    Signatures    \* Set of all valid cryptographic signatures

VARIABLES 
    intent_pool,       \* Unverified payloads submitted by actors
    verified_intent,   \* Payloads cryptographically bound by the Gateway
    execution_buffer,  \* Immutable buffer handed off to the DAB runtime
    execution_log      \* Final executed state

vars == <<intent_pool, verified_intent, execution_buffer, execution_log>>

Init == 
    /\ intent_pool = {}
    /\ verified_intent = {}
    /\ execution_buffer = <<>>
    /\ execution_log = <<>>

\* Abstracted Cryptographic Oracle
\* In physical Rust, this is the ed25519/RSA verification in verifier.rs
IsValidSignature(actor, payload, sig) == TRUE 

\* Transition 1: An actor submits an intent to the system
SubmitIntent(actor, payload, sig) ==
    /\ intent_pool' = intent_pool \cup {<<actor, payload, sig>>}
    /\ UNCHANGED <<verified_intent, execution_buffer, execution_log>>

\* Transition 2: The Gateway atomic check and bind (The Core Security Boundary)
VerifyAndBind(actor, payload, sig) ==
    /\ <<actor, payload, sig>> \in intent_pool
    /\ IsValidSignature(actor, payload, sig)
    /\ verified_intent' = verified_intent \cup {payload}
    /\ execution_buffer' = Append(execution_buffer, payload)
    /\ UNCHANGED <<intent_pool, execution_log>>

\* Transition 3: The Runtime consumes the exact bytes verified
Execute ==
    /\ Len(execution_buffer) > 0
    /\ LET payload == Head(execution_buffer) IN
        /\ execution_log' = Append(execution_log, payload)
        /\ execution_buffer' = Tail(execution_buffer)
    /\ UNCHANGED <<intent_pool, verified_intent>>

Next == 
    \/ \E a \in Actors, p \in Payloads, s \in Signatures : SubmitIntent(a, p, s)
    \/ \E a \in Actors, p \in Payloads, s \in Signatures : VerifyAndBind(a, p, s)
    \/ Execute

\* ---- FORMAL TARGET INVARIANTS ----

\* No execution can occur without prior cryptographic verification.
\* Mitigates Confused Deputy and unauthorized code execution.
NoExecutionWithoutVerification == 
    \A p \in {execution_log[i] : i \in 1..Len(execution_log)} : 
        p \in verified_intent

\* Strict Equivalence: $\Delta_{\text{DE}} = 0$
\* The execution log must mathematically match the verified intent. 
\* Prevents TOCTOU and in-flight payload mutation.
DeltaZero == 
    \A i \in 1..Len(execution_log) : 
        execution_log[i] \in verified_intent

Spec == Init /\ [][Next]_vars

StateSpaceBound ==
    /\ Len(execution_buffer) <= 3
    /\ Len(execution_log) <= 3

=============================================================================
