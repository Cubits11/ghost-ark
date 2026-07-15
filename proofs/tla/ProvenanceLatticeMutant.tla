----------------------------- MODULE ProvenanceLatticeMutant -----------------------------
(* Deliberately broken variant of ProvenanceLattice.                            *)
(* MUTATION: AddEvidenceMutant permits direct assignment of rank 3              *)
(* (CROSS_WITNESSED, derive-only) by ranging r over Ranks instead of            *)
(* AssignableRanks. TypeOK is widened accordingly so the run demonstrates the   *)
(* targeted invariant failing, not a type error.                                *)
(* Expected checker result: Invariant NoDeriveOnlyAssignment is violated.       *)
(* A run of this module that reports no error means the invariants are          *)
(* vacuous and the baseline result must not be trusted.                         *)

EXTENDS Naturals, FiniteSets

CONSTANTS Sources, MaxRecords, Floor, K

VARIABLES evidence, admitted

vars == <<evidence, admitted>>

Ranks == 0..4
AssignableRanks == {0, 1, 2, 4}

ASSUME Floor \in AssignableRanks
ASSUME K \in Nat \ {0}
ASSUME MaxRecords \in Nat

Meet(a, b) == IF a <= b THEN a ELSE b

Init ==
  /\ evidence = {}
  /\ admitted = {}

AddEvidenceMutant(s, r) ==
  /\ Cardinality(evidence) < MaxRecords
  /\ evidence' = evidence \cup {[src |-> s, rank |-> r]}
  /\ UNCHANGED admitted

AdmitDelegated(c, rv) ==
  /\ Cardinality(admitted) < MaxRecords
  /\ admitted' = admitted \cup {[claimed |-> c, reverified |-> rv, adm |-> Meet(c, rv)]}
  /\ UNCHANGED evidence

Next ==
  \/ \E s \in Sources, r \in Ranks: AddEvidenceMutant(s, r)
  \/ \E c \in Ranks, rv \in AssignableRanks: AdmitDelegated(c, rv)

TypeOK ==
  /\ evidence \subseteq [src: Sources, rank: Ranks]
  /\ admitted \subseteq [claimed: Ranks, reverified: AssignableRanks, adm: Ranks]

NoDeriveOnlyAssignment ==
  \A e \in evidence: e.rank # 3

NoLaundering ==
  \A d \in admitted: d.adm <= d.claimed /\ d.adm <= d.reverified

Spec == Init /\ [][Next]_vars

=============================================================================
