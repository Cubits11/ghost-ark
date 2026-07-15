----------------------- MODULE DAB_NonceLedger -----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Agents, Nonces, MaxLedgerSize

VARIABLES ledger, agentState, agentNonce

vars == <<ledger, agentState, agentNonce>>

Init == 
    /\ ledger = {}
    /\ agentState = [a \in Agents |-> "Init"]
    /\ agentNonce = [a \in Agents |-> "None"]

ConsumeNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ n \notin ledger
    /\ Cardinality(ledger) < MaxLedgerSize
    /\ ledger' = ledger \cup {n}
    /\ agentState' = [agentState EXCEPT ![a] = "Executed"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]

RejectNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ n \in ledger
    /\ agentState' = [agentState EXCEPT ![a] = "Rejected"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]
    /\ UNCHANGED ledger

GarbageCollect(n) ==
    /\ n \in ledger
    /\ ledger' = ledger \setminus {n}
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
