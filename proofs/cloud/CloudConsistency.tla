---------------------- MODULE CloudConsistency ----------------------
EXTENDS Naturals, Sequences, FiniteSets

VARIABLES
    objectVersions,
    latestVersion

vars == <<objectVersions, latestVersion>>

Init ==
    /\ objectVersions = <<>>
    /\ latestVersion = 0

WriteObject(v) ==
    /\ v > latestVersion
    /\ latestVersion' = v
    /\ objectVersions' = Append(objectVersions, v)

Next ==
    \E v \in 1..10 : WriteObject(v)

MonotonicityInvariant ==
    \A i, j \in 1..Len(objectVersions) :
        (i <= j) => (objectVersions[i] <= objectVersions[j])

=============================================================================
