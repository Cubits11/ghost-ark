----------------------------- MODULE TenantIsolation -----------------------------

EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Tenants, Resources

VARIABLES owner, accessLog

Init ==
  /\ owner \in [Resources -> Tenants]
  /\ accessLog = << >>

RequestAccess(t, r) ==
  /\ t \in Tenants
  /\ r \in Resources
  /\ owner[r] = t
  /\ accessLog' = Append(accessLog, [tenant |-> t, resource |-> r, decision |-> "allow"])
  /\ UNCHANGED owner

DenyCrossTenant(t, r) ==
  /\ t \in Tenants
  /\ r \in Resources
  /\ owner[r] # t
  /\ accessLog' = Append(accessLog, [tenant |-> t, resource |-> r, decision |-> "deny"])
  /\ UNCHANGED owner

Next ==
  \E t \in Tenants, r \in Resources:
    RequestAccess(t, r) \/ DenyCrossTenant(t, r)

NoCrossTenantAllow ==
  \A i \in 1..Len(accessLog):
    accessLog[i].decision = "allow" =>
      owner[accessLog[i].resource] = accessLog[i].tenant

Spec == Init /\ [][Next]_<<owner, accessLog>>

=============================================================================
