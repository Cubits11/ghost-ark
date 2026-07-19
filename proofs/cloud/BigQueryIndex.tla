---------------------- MODULE BigQueryIndex ----------------------
EXTENDS Naturals, FiniteSets

VARIABLES indexedReceipts, insertAttempts

vars == <<indexedReceipts, insertAttempts>>

Init == 
    /\ indexedReceipts = {}
    /\ insertAttempts = 0

InsertReceipt(r) ==
    /\ insertAttempts' = insertAttempts + 1
    /\ indexedReceipts' = indexedReceipts \union {r}

Next == \E r \in 1..5 : InsertReceipt(r)

IdempotencyInvariant ==
    Cardinality(indexedReceipts) <= 5

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

=============================================================================
