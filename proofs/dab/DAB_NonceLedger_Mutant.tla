----------------------- MODULE DAB_NonceLedger_Mutant -----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Agents, Nonces, MaxLedgerSize

VARIABLES ledger, agentState, agentNonce

vars == <<ledger, agentState, agentNonce>>

Init == 
    /\ ledger = {}
    /\ agentState = [a \in Agents |-> "Init"]
    /\ agentNonce = [a \in Agents |-> "None"]

CheckNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ n \notin ledger
    /\ agentState' = [agentState EXCEPT ![a] = "Checked"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]
    /\ UNCHANGED ledger

CommitNonce(a) ==
    /\ agentState[a] = "Checked"
    /\ Cardinality(ledger) < MaxLedgerSize
    /\ ledger' = ledger \cup {agentNonce[a]}
    /\ agentState' = [agentState EXCEPT ![a] = "Executed"]
    /\ UNCHANGED agentNonce

RejectNonce(a, n) ==
    /\ agentState[a] = "Init"
    /\ n \in ledger
    /\ agentState' = [agentState EXCEPT ![a] = "Rejected"]
    /\ agentNonce' = [agentNonce EXCEPT ![a] = n]
    /\ UNCHANGED ledger

GarbageCollect(n) ==
    /\ n \in ledger
    /\ ledger' = ledger \ {n}
    /\ UNCHANGED <<agentState, agentNonce>>

Next == 
    \/ \E a \in Agents, n \in Nonces : CheckNonce(a, n)
    \/ \E a \in Agents : CommitNonce(a)
    \/ \E a \in Agents, n \in Nonces : RejectNonce(a, n)
    \/ \E n \in Nonces : GarbageCollect(n)

Fairness == 
    \A n \in Nonces : WF_vars(GarbageCollect(n))

Spec == Init /\ [][Next]_vars /\ Fairness

NoReplays == \A a1, a2 \in Agents :
    (a1 # a2 /\ agentState[a1] = "Executed" /\ agentState[a2] = "Executed")
    => agentNonce[a1] # agentNonce[a2]

EventualGC == \A n \in Nonces : (n \in ledger) ~> (n \notin ledger)
=============================================================================
