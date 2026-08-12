----------------------------- MODULE TenantIsolation -----------------------------
(* Bounded model of the tenant-isolation decision boundary, with MUTABLE       *)
(* ownership and a decision-time cache.                                        *)
(*                                                                             *)
(* WHY THIS SHAPE. The first version of this module was tautological: its only *)
(* allow action was guarded by `owner[r] = t`, and its invariant asserted that *)
(* every allow entry satisfies `owner[r] = t` — the guard restated. No         *)
(* behaviour could violate it, so a clean TLC run measured nothing. Real       *)
(* cross-tenant leakage does not happen while ownership stands still; it       *)
(* happens when ownership CHANGES and a decision is made against a stale read. *)
(* So this model has: ownership transfer (revocation is transfer away), a      *)
(* decision path that consults a cached view of ownership rather than the      *)
(* authoritative record, and a cache-coherence discipline (transfer            *)
(* invalidates synchronously) that is exactly what the mutant deletes.         *)
(*                                                                             *)
(* Each log entry records the AUTHORITATIVE owner at decision time — the       *)
(* receipt. The invariant checks entries against that recorded truth, while    *)
(* the grant guard reads only the cache. The two are connected by nothing but  *)
(* the invalidation discipline, which is the claim under check.                *)
(*                                                                             *)
(* Companion doc: docs/research/FORMAL_METHODS_NOTES.md.                       *)
(* NON-CLAIM: a bounded model of the design. Not a statement about AWS IAM,    *)
(* Cognito, DynamoDB, any TypeScript handler, or any deployment.               *)

EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Tenants, Resources, MaxLog

ASSUME MaxLog \in Nat

VARIABLES owner, cache, accessLog

vars == <<owner, cache, accessLog>>

Init ==
  /\ owner \in [Resources -> Tenants]
  /\ cache = owner
  /\ accessLog = << >>

(* The decision consults the CACHE, not the authoritative owner. That is the   *)
(* honest shape of a gateway that does not re-read the ownership store on      *)
(* every request.                                                              *)
Grant(t, r) ==
  /\ Len(accessLog) < MaxLog
  /\ cache[r] = t
  /\ accessLog' = Append(accessLog,
       [tenant |-> t, resource |-> r, decision |-> "allow",
        ownerAtDecision |-> owner[r]])
  /\ UNCHANGED <<owner, cache>>

Deny(t, r) ==
  /\ Len(accessLog) < MaxLog
  /\ cache[r] # t
  /\ accessLog' = Append(accessLog,
       [tenant |-> t, resource |-> r, decision |-> "deny",
        ownerAtDecision |-> owner[r]])
  /\ UNCHANGED <<owner, cache>>

(* Ownership transfer; revocation is transfer away from the holder. The        *)
(* baseline discipline: transfer invalidates the decision cache ATOMICALLY.    *)
(* This conjunct is the load-bearing line — the mutant deletes exactly it.     *)
Transfer(r, t) ==
  /\ owner[r] # t
  /\ owner' = [owner EXCEPT ![r] = t]
  /\ cache' = [cache EXCEPT ![r] = t]
  /\ UNCHANGED accessLog

(* The only resync path other than Transfer itself. Coherent caches make this  *)
(* a stutter; in the mutant it is the repair that arrives too late for         *)
(* decisions already logged.                                                   *)
RefreshCache(r) ==
  /\ cache' = [cache EXCEPT ![r] = owner[r]]
  /\ UNCHANGED <<owner, accessLog>>

Next ==
  \/ \E t \in Tenants, r \in Resources: Grant(t, r) \/ Deny(t, r) \/ Transfer(r, t)
  \/ \E r \in Resources: RefreshCache(r)

LogEntryOK(e) ==
  /\ e.tenant \in Tenants
  /\ e.resource \in Resources
  /\ e.decision \in {"allow", "deny"}
  /\ e.ownerAtDecision \in Tenants

TypeOK ==
  /\ owner \in [Resources -> Tenants]
  /\ cache \in [Resources -> Tenants]
  /\ Len(accessLog) <= MaxLog
  /\ \A i \in 1..Len(accessLog): LogEntryOK(accessLog[i])

(* Every allow was granted to the tenant who owned the resource AT THE MOMENT  *)
(* the decision was made. Not a guard restatement: the guard reads cache[r],   *)
(* this checks the authoritative owner recorded at decision time. It holds     *)
(* only while every path that changes ownership also invalidates the cache     *)
(* before another decision can be logged.                                      *)
NoCrossTenantAllow ==
  \A i \in 1..Len(accessLog):
    accessLog[i].decision = "allow" =>
      accessLog[i].ownerAtDecision = accessLog[i].tenant

Spec == Init /\ [][Next]_vars

=============================================================================
