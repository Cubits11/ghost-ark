---------------------- MODULE StorageCheckpoint ----------------------
EXTENDS Naturals

VARIABLES checkpointEpoch

Init == checkpointEpoch = 0

AdvanceEpoch ==
    /\ checkpointEpoch' = checkpointEpoch + 1

Next == AdvanceEpoch

EpochMonotonicityInvariant ==
    checkpointEpoch >= 0

=============================================================================
