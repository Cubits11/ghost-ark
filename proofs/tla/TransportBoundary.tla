----------------------------- MODULE TransportBoundary -----------------------------
(* Does silent compromise depend on the transport parser failing closed?        *)
(*                                                                              *)
(* The empirical E2E run found that a strict HTTP client rejects smuggled       *)
(* trailing bytes ("Parse Error: Data after Connection: close") and fails       *)
(* closed. That is a RUNTIME ACCIDENT of one client, not a proven property --   *)
(* a different runtime could accept the bytes. This model therefore treats      *)
(* transport strictness as an explicit ASSUMPTION (the `mode` parameter), never *)
(* an invariant, and checks that no adversarial transit is silently accepted in *)
(* EITHER mode. The load-bearing component is the reconciler, not the parser.   *)
(*                                                                              *)
(* Companion: tests/integration/mMeasurementE2E.test.ts (empirical run),        *)
(* packages/research-frontier/src/oracle/byteReconciler.ts (reconciler).        *)
(* Status: stub until a checker artifact exists under proofs/tla/artifacts/.    *)

EXTENDS FiniteSets

CONSTANTS Kinds, Modes

VARIABLE ledger

(* A receipt exists only if the transport did not fail closed on this transit.  *)
(* Strict transport rejects a smuggled response, so no receipt is emitted.       *)
ReceiptValid(kind, mode) ==
  CASE kind = "honest"      -> TRUE
    [] kind = "smuggle"     -> (mode = "lenient")
    [] kind = "sidechannel" -> TRUE
    [] OTHER                -> FALSE

(* The reconciler reports clean only for an honest transit. A smuggled response *)
(* (when a receipt exists at all) leaves extra wire bytes; a side channel       *)
(* leaves an egress the receipt never recorded. Both are transport-independent. *)
OracleClean(kind, mode) ==
  CASE kind = "honest"      -> TRUE
    [] kind = "smuggle"     -> FALSE
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

(* No non-honest transit is both receipt-valid and oracle-clean: nothing        *)
(* adversarial is silently accepted, in strict OR lenient transport.            *)
NoSilentCompromise ==
  \A e \in ledger: ~(e.rv /\ e.oc /\ e.kind # "honest")

Spec == Init /\ [][Next]_ledger

=============================================================================
