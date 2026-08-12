----------------------------- MODULE TenantIsolationMutant -----------------------------
(* Deliberately broken variant of TenantIsolation.                             *)
(* MUTATION: TransferMutant changes ownership WITHOUT invalidating the         *)
(* decision cache — revocation does not reach the gateway's cached view, so a  *)
(* grant can be decided against a stale owner. This is the seeded defect and   *)
(* the only difference from the baseline: Transfer's `cache'` conjunct is      *)
(* replaced by UNCHANGED cache. RefreshCache still exists, but nothing forces  *)
(* it to run before the next decision — which is precisely the race.           *)
(* Expected checker result: invariant NoCrossTenantAllow is violated           *)
(* (transfer resourceA away from tenantA, then Grant(tenantA, resourceA) via   *)
(* the stale cache).                                                           *)
(* A run of this module that reports no error means the invariant is vacuous   *)
(* and the baseline result must not be trusted.                                *)

EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Tenants, Resources, MaxLog

ASSUME MaxLog \in Nat

VARIABLES owner, cache, accessLog

vars == <<owner, cache, accessLog>>

Init ==
  /\ owner \in [Resources -> Tenants]
  /\ cache = owner
  /\ accessLog = << >>

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

(* THE SEEDED DEFECT: ownership moves, the cache does not.                     *)
TransferMutant(r, t) ==
  /\ owner[r] # t
  /\ owner' = [owner EXCEPT ![r] = t]
  /\ UNCHANGED <<cache, accessLog>>

RefreshCache(r) ==
  /\ cache' = [cache EXCEPT ![r] = owner[r]]
  /\ UNCHANGED <<owner, accessLog>>

Next ==
  \/ \E t \in Tenants, r \in Resources: Grant(t, r) \/ Deny(t, r) \/ TransferMutant(r, t)
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

NoCrossTenantAllow ==
  \A i \in 1..Len(accessLog):
    accessLog[i].decision = "allow" =>
      accessLog[i].ownerAtDecision = accessLog[i].tenant

Spec == Init /\ [][Next]_vars

=============================================================================
