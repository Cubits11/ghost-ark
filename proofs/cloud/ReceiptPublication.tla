---------------------- MODULE ReceiptPublication ----------------------
EXTENDS Naturals, Sequences, FiniteSets

VARIABLES
    publishedReceipts,
    storageObjects,
    bigQueryRows,
    retryCount

vars == <<publishedReceipts, storageObjects, bigQueryRows, retryCount>>

Init ==
    /\ publishedReceipts = {}
    /\ storageObjects = {}
    /\ bigQueryRows = {}
    /\ retryCount = 0

UploadToStorage(r) ==
    /\ r \notin publishedReceipts
    /\ storageObjects' = storageObjects \union {r}
    /\ UNCHANGED <<publishedReceipts, bigQueryRows, retryCount>>

IndexInBigQuery(r) ==
    /\ r \in storageObjects
    /\ r \notin bigQueryRows
    /\ bigQueryRows' = bigQueryRows \union {r}
    /\ publishedReceipts' = publishedReceipts \union {r}
    /\ UNCHANGED <<storageObjects, retryCount>>

RetryPublish(r) ==
    /\ retryCount < 3
    /\ retryCount' = retryCount + 1
    /\ UNCHANGED <<publishedReceipts, storageObjects, bigQueryRows>>

Next ==
    \E r \in 1..5 :
        \/ UploadToStorage(r)
        \/ IndexInBigQuery(r)
        \/ RetryPublish(r)

\* Invariant: No receipt indexed in BigQuery without corresponding Cloud Storage object
StorageBeforeIndexInvariant ==
    \A r \in bigQueryRows : r \in storageObjects

\* Liveness Property: Under weak fairness, every uploaded object eventually gets indexed in BigQuery
EventualIndexingProperty ==
    \A r \in 1..5 : (r \in storageObjects) ~> (r \in bigQueryRows)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

=============================================================================
