----------------------- MODULE SpeculativeCollapseMutant -----------------------
(* Deliberately broken variant of SpeculativeCollapse.                          *)
(* MUTATION: CollapseMutant trusts the dream thread's claimed rank instead of   *)
(* the gateway record — the assertion-conditioned-compliance poisoning of the   *)
(* collapse function.                                                           *)
(* Expected checker result: Invariant CollapseSound is violated (a speculation  *)
(* with gateway rank 0 and claimed rank 4 collapses into canonical state).      *)

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

StartSpec(id, g, c) ==
  /\ ~\E s \in specs: s.id = id
  /\ ~\E e \in canonical: e.id = id
  /\ specs' = specs \cup {[id |-> id, gateway |-> g, claimed |-> c]}
  /\ UNCHANGED canonical

CollapseMutant(s) ==
  /\ s \in specs
  /\ s.claimed >= Floor
  /\ canonical' = canonical \cup {[id |-> s.id, rank |-> s.gateway]}
  /\ specs' = specs \ {s}

Abort(s) ==
  /\ s \in specs
  /\ specs' = specs \ {s}
  /\ UNCHANGED canonical

Next ==
  \/ \E id \in SpecIds, g \in AssignableRanks, c \in Ranks: StartSpec(id, g, c)
  \/ \E s \in specs: CollapseMutant(s) \/ Abort(s)

TypeOK ==
  /\ specs \subseteq [id: SpecIds, gateway: AssignableRanks, claimed: Ranks]
  /\ canonical \subseteq [id: SpecIds, rank: Ranks]

CollapseSound ==
  \A e \in canonical: e.rank >= Floor

Spec == Init /\ [][Next]_vars

=============================================================================
