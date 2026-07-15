----------------------------- MODULE ProvenanceLattice -----------------------------
(* Narrow finite model of the Ghost-Ark evidence provenance lattice (v1 chain). *)
(* Scope: rank order, meet-based delegation admission, floor evaluation.        *)
(* Companion spec: docs/research/EVIDENCE_PROVENANCE_LATTICE.md.                *)
(* Status: model stub. Not checked until a TLC output artifact exists under     *)
(* proofs/tla/artifacts/, per docs/research/FORMAL_METHODS_NOTES.md.            *)

EXTENDS Naturals, FiniteSets

CONSTANTS Sources, MaxRecords, Floor, K

VARIABLES evidence, admitted

vars == <<evidence, admitted>>

(* Ranks: 0 AGENT_ASSERTED, 1 GATEWAY_RECORDED, 2 SOURCE_SIGNED,     *)
(* 3 CROSS_WITNESSED (derive-only), 4 EXTERNALLY_ATTESTED.            *)
Ranks == 0..4
AssignableRanks == {0, 1, 2, 4}

ASSUME Floor \in AssignableRanks
ASSUME K \in Nat \ {0}
ASSUME MaxRecords \in Nat

Meet(a, b) == IF a <= b THEN a ELSE b

Init ==
  /\ evidence = {}
  /\ admitted = {}

(* Boundary code assigns only assignable ranks to single elements;   *)
(* mirrors assertAssignableProvenanceClass in provenanceLattice.ts.  *)
AddEvidence(s, r) ==
  /\ Cardinality(evidence) < MaxRecords
  /\ evidence' = evidence \cup {[src |-> s, rank |-> r]}
  /\ UNCHANGED admitted

(* Delegation admission: claimed rank may be anything, including the *)
(* derive-only rank; the receiving boundary re-verifies at an        *)
(* assignable rank and admits at the meet.                           *)
AdmitDelegated(c, rv) ==
  /\ Cardinality(admitted) < MaxRecords
  /\ admitted' = admitted \cup {[claimed |-> c, reverified |-> rv, adm |-> Meet(c, rv)]}
  /\ UNCHANGED evidence

Next ==
  \/ \E s \in Sources, r \in AssignableRanks: AddEvidence(s, r)
  \/ \E c \in Ranks, rv \in AssignableRanks: AdmitDelegated(c, rv)

QualifyingSources == {e.src : e \in {x \in evidence : x.rank >= Floor}}

Satisfied == Cardinality(QualifyingSources) >= K

TypeOK ==
  /\ evidence \subseteq [src: Sources, rank: AssignableRanks]
  /\ admitted \subseteq [claimed: Ranks, reverified: AssignableRanks, adm: Ranks]

(* Mutant check: permit r = 3 in AddEvidence and this must fail.     *)
NoDeriveOnlyAssignment ==
  \A e \in evidence: e.rank # 3

(* P2: admitted rank never exceeds the claimed rank nor the          *)
(* independently re-verified rank. Both conjuncts are required;      *)
(* bounding by the re-verified rank alone is not the meet.           *)
NoLaundering ==
  \A d \in admitted: d.adm <= d.claimed /\ d.adm <= d.reverified

(* Once a floor requirement is satisfied, adding records never       *)
(* unsatisfies it.                                                   *)
SatisfiedStable == [][Satisfied => Satisfied']_vars

(* P1 flood property: adding below-floor evidence never changes the  *)
(* qualifying source set.                                            *)
FloodImmunity ==
  [][\A s \in Sources, r \in AssignableRanks:
       (r < Floor /\ AddEvidence(s, r)) => QualifyingSources' = QualifyingSources]_vars

Spec == Init /\ [][Next]_vars

=============================================================================
