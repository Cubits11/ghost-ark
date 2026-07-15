-------------------------- MODULE TransportBoundaryMutant --------------------------
(* Deliberately broken variant of TransportBoundary.                            *)
(* MUTATION: the reconciler ignores extra wire bytes, so a smuggled response is *)
(* treated as clean. Under LENIENT transport a receipt exists AND the mutant    *)
(* reconciler calls it clean, so a smuggled transit is silently accepted and    *)
(* NoSilentCompromise is violated.                                              *)
(*                                                                              *)
(* This exposes the model's core lesson: under strict transport alone the       *)
(* mutant is NOT caught (smuggle yields no receipt), so a reviewer who tests     *)
(* only strict transport cannot tell whether the reconciler works. The lenient  *)
(* mode is what proves the reconciler -- not the parser accident -- is doing    *)
(* the work.                                                                     *)

EXTENDS FiniteSets

CONSTANTS Kinds, Modes

VARIABLE ledger

ReceiptValid(kind, mode) ==
  CASE kind = "honest"      -> TRUE
    [] kind = "smuggle"     -> (mode = "lenient")
    [] kind = "sidechannel" -> TRUE
    [] OTHER                -> FALSE

(* MUTATION: smuggle is now considered clean (extra bytes ignored). *)
OracleClean(kind, mode) ==
  CASE kind = "honest"      -> TRUE
    [] kind = "smuggle"     -> TRUE
    [] kind = "sidechannel" -> FALSE
    [] OTHER                -> FALSE

MakeRecord(k, m) == [kind |-> k, mode |-> m, rv |-> ReceiptValid(k, m), oc |-> OracleClean(k, m)]

Init == ledger = {}

Commit(k, m) ==
  /\ k \in Kinds
  /\ m \in Modes
  /\ ledger' = ledger \cup {MakeRecord(k, m)}

Next == \E k \in Kinds, m \in Modes: Commit(k, m)

TypeOK == ledger \subseteq [kind: Kinds, mode: Modes, rv: BOOLEAN, oc: BOOLEAN]

NoSilentCompromise ==
  \A e \in ledger: ~(e.rv /\ e.oc /\ e.kind # "honest")

Spec == Init /\ [][Next]_ledger

=============================================================================
