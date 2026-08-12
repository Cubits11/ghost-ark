# TLA+ Models — Reproduction Protocol

Models in this directory are stubs until a genuine checker output artifact exists under `proofs/tla/artifacts/`. Simulated, transcribed, or hand-written checker logs are not artifacts and must never be committed here. Per docs/research/FORMAL_METHODS_NOTES.md, checked-model wording is allowed only after a real run is recorded with the command used.

## Models

- `TenantIsolation.tla` / `.cfg` — tenant-isolation decision boundary with mutable ownership and a decision-time cache; NoCrossTenantAllow checks each allow entry against the authoritative owner recorded at decision time (checked 2026-08-12 with TLC 2.19 / tla2tools v1.7.4; 149,796 distinct states, matching the pre-registered expectation below; see artifacts/TenantIsolation.tlc.txt). Until 2026-08-12 this was a declared stub whose invariant restated the guard of its only allow action — no behaviour could violate it — and whose log was unbounded, so TLC could not terminate.
- `TenantIsolationMutant.tla` / `.cfg` — ownership transfer that does NOT invalidate the decision cache; a grant decided against the stale cache produces an allow entry whose recorded owner differs from the requesting tenant; NoCrossTenantAllow violation reproduced 2026-08-12 (see artifacts/TenantIsolationMutant.tlc.txt)
- `ProvenanceLattice.tla` / `.cfg` — evidence provenance lattice: meet-based delegation admission, floor evaluation (checked 2026-07-14 with TLC 2.19; see artifacts/ProvenanceLattice.tlc.txt; distinct-state count matched the pre-registered expectation below)
- `ProvenanceLatticeMutant.tla` / `.cfg` — deliberately broken variant permitting direct assignment of the derive-only rank; exists to show the invariants are load-bearing (violation reproduced 2026-07-14; see artifacts/ProvenanceLatticeMutant.tlc.txt)
- `SpeculativeCollapse.tla` / `.cfg` — speculative-collapse rule: canonical state admits an effect only on the gateway-recorded rank, never the speculative thread's claim (checked 2026-07-14 with TLC 2.19; 529 distinct states; see artifacts/SpeculativeCollapse.tlc.txt)
- `SpeculativeCollapseMutant.tla` / `.cfg` — claim-trusting collapse, the assertion-conditioned poisoning of the reconciler; CollapseSound violation reproduced 2026-07-14 (see artifacts/SpeculativeCollapseMutant.tlc.txt)
- `TransportBoundary.tla` / `.cfg` — silent-compromise is prevented in both strict and lenient transport modes; transport strictness is an explicit assumption, not an asserted property (checked 2026-07-15 with TLC 2.19; 64 distinct states; see artifacts/TransportBoundary.tlc.txt)
- `TransportBoundaryMutant.tla` / `.cfg` — reconciler that ignores extra wire bytes; NoSilentCompromise violation reproduced under the lenient mode 2026-07-15 (see artifacts/TransportBoundaryMutant.tlc.txt). Note: constants must be quoted strings in the .cfg, or the CASE comparisons fall through and both models pass vacuously.

## Commands

Requires Java 11+ and `tla2tools.jar` from the official TLA+ releases (https://github.com/tlaplus/tlaplus/releases).

```sh
cd proofs/tla
mkdir -p artifacts

# Baseline: expected result is no invariant or property violation.
java -cp /path/to/tla2tools.jar tlc2.TLC -workers auto \
  -config ProvenanceLattice.cfg ProvenanceLattice.tla \
  | tee artifacts/ProvenanceLattice.tlc.txt

# Mutant: expected result is a reported violation of NoDeriveOnlyAssignment.
# A clean mutant run means the invariants are vacuous; do not record a baseline claim.
java -cp /path/to/tla2tools.jar tlc2.TLC -workers auto \
  -config ProvenanceLatticeMutant.cfg ProvenanceLatticeMutant.tla \
  | tee artifacts/ProvenanceLatticeMutant.tlc.txt

# SpeculativeCollapse baseline, then its claim-trusting mutant
# (expected result: CollapseSound violated).
java -cp /path/to/tla2tools.jar tlc2.TLC -workers auto \
  -config SpeculativeCollapse.cfg SpeculativeCollapse.tla \
  | tee artifacts/SpeculativeCollapse.tlc.txt

java -cp /path/to/tla2tools.jar tlc2.TLC -workers auto \
  -config SpeculativeCollapseMutant.cfg SpeculativeCollapseMutant.tla \
  | tee artifacts/SpeculativeCollapseMutant.tlc.txt
```

## Pre-registered expectation for the baseline state space

For `Sources = {s1, s2, s3}`, `MaxRecords = 3`: evidence records number 3 sources x 4 assignable ranks = 12, so reachable evidence sets of size <= 3 number 1 + 12 + 66 + 220 = 299. Admitted records number 5 claimed x 4 re-verified = 20 (the meet is determined), so reachable admitted sets number 1 + 20 + 190 + 1140 = 1351. The actions are independent, so distinct reachable states = 299 x 1351 = 403,949.

A genuine baseline run must report 403,949 distinct states. Treat any materially different count as a configuration mismatch or a model edit, and do not record the artifact until the discrepancy is explained. This expectation is written down before any run so the artifact can be checked against it, not fitted to it.

### TenantIsolation (registered 2026-08-12, before the first run)

For `Tenants = {tenantA, tenantB}`, `Resources = {resourceA, resourceB}`, `MaxLog = 5`: in the baseline the cache is inductively coherent (Init sets it to owner; Transfer updates both; Refresh is then a no-op), so a state is determined by (owner, accessLog). Owner maps number 2^2 = 4, all reachable. Distinct log entries number 8: an allow entry fixes ownerAtDecision = tenant (2 tenants x 2 resources = 4), and a deny entry with two tenants fixes ownerAtDecision as the other tenant (4). Transfers can rearrange ownership freely between appends without touching the log, so every sequence of length <= 5 over the 8 entries is reachable under every final owner map: distinct states = 4 x (1 + 8 + 64 + 512 + 4096 + 32768) = 4 x 37,449 = 149,796.

A genuine baseline run must report 149,796 distinct states and terminate. The first run (2026-08-12, TLC 2.19 under the v1.7.4 pin) reported exactly this count. The mutant's distinct-state count is NOT a figure (retraction R11): it halts at the first counterexample under `-workers auto` and varied 94-140 over n=10 runs on one host. Report the mutant's verdict, never its count.

## After a real run

1. Confirm the baseline artifact reports no violation and the distinct-state count matches the expectation above.
2. Confirm the mutant artifact reports the NoDeriveOnlyAssignment violation.
3. Only then update docs/research/FORMAL_METHODS_NOTES.md using its allowed wording for a checked finite model, citing both artifacts, the checker version, and the exact commands.
