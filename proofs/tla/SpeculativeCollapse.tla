--------------------------- MODULE SpeculativeCollapse ---------------------------
(* Narrow finite model of speculative-collapse semantics.                       *)
(* A speculation carries two ranks for its supporting evidence: the rank the    *)
(* gateway recorded (assignable ranks only) and the rank the speculative        *)
(* "dream" thread claims (any rank at all — assertion-conditioned compliance    *)
(* means the claim can be arbitrarily inflated). The collapse rule consults     *)
(* only the gateway rank.                                                       *)
(* Companion implementation: packages/research-frontier/src/speculativeExecution *)
(* Status: stub until a checker artifact exists under proofs/tla/artifacts/.    *)

EXTENDS Naturals, FiniteSets

CONSTANTS SpecIds, Floor

VARIABLES canonical, specs

vars == <<canonical, specs>>

Ranks == 0..4
AssignableRanks == {0, 1, 2, 4}

ASSUME Floor \in AssignableRanks

Init ==
  /\ canonical = {}
  /\ specs = {}

(* The dream thread may claim any rank c, independent of the gateway rank g. *)
StartSpec(id, g, c) ==
  /\ ~\E s \in specs: s.id = id
  /\ ~\E e \in canonical: e.id = id
  /\ specs' = specs \cup {[id |-> id, gateway |-> g, claimed |-> c]}
  /\ UNCHANGED canonical

(* Collapse consults the gateway record only; the claim is never read. *)
Collapse(s) ==
  /\ s \in specs
  /\ s.gateway >= Floor
  /\ canonical' = canonical \cup {[id |-> s.id, rank |-> s.gateway]}
  /\ specs' = specs \ {s}

Abort(s) ==
  /\ s \in specs
  /\ specs' = specs \ {s}
  /\ UNCHANGED canonical

Next ==
  \/ \E id \in SpecIds, g \in AssignableRanks, c \in Ranks: StartSpec(id, g, c)
  \/ \E s \in specs: Collapse(s) \/ Abort(s)

TypeOK ==
  /\ specs \subseteq [id: SpecIds, gateway: AssignableRanks, claimed: Ranks]
  /\ canonical \subseteq [id: SpecIds, rank: Ranks]

(* No effect reaches canonical state below the floor, no matter what the  *)
(* dream thread claimed.                                                   *)
CollapseSound ==
  \A e \in canonical: e.rank >= Floor

Spec == Init /\ [][Next]_vars

=============================================================================
