----------------------- MODULE DAB_NonceLedger -----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Agents, Nonces, MaxLedgerSize

VARIABLES ledger, agentState, agentNonce, spent

vars == <<ledger, agentState, agentNonce, spent>>

Init == 
    /\ ledger = {}
    /\ spent = {}
    /\ agentState = [a \in Agents |-> "Init"]
    /\ agentNonce = [a \in Agents |-> "None"]

ConsumeNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ n \notin ledger
    /\ n \notin spent
    /\ Cardinality(ledger) < MaxLedgerSize
    /\ ledger' = ledger \cup {n}
    /\ agentState' = [agentState EXCEPT ![a] = "Executed"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]
    /\ UNCHANGED spent

RejectNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ (n \in ledger \/ n \in spent)
    /\ agentState' = [agentState EXCEPT ![a] = "Rejected"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]
    /\ UNCHANGED <<ledger, spent>>

GarbageCollect(n) ==
    /\ n \in ledger
    /\ ledger' = ledger \ {n}
    /\ spent' = spent \cup {n}
    /\ UNCHANGED <<agentState, agentNonce>>

Next == 
    \/ \E a \in Agents, n \in Nonces : ConsumeNonce(a, n)
    \/ \E a \in Agents, n \in Nonces : RejectNonce(a, n)
    \/ \E n \in Nonces : GarbageCollect(n)

Fairness == 
    \A n \in Nonces : WF_vars(GarbageCollect(n))

Spec == Init /\ [][Next]_vars /\ Fairness

\* Safety: A nonce is never executed by more than one agent
NoReplays == \A a1, a2 \in Agents :
    (a1 # a2 /\ agentState[a1] = "Executed" /\ agentState[a2] = "Executed")
    => agentNonce[a1] # agentNonce[a2]

\* Liveness: Eventual Garbage Collection
EventualGC == \A n \in Nonces : (n \in ledger) ~> (n \notin ledger)
=============================================================================
