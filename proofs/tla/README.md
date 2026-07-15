# TLA+ Models — Reproduction Protocol

Models in this directory are stubs until a genuine checker output artifact exists under `proofs/tla/artifacts/`. Simulated, transcribed, or hand-written checker logs are not artifacts and must never be committed here. Per docs/research/FORMAL_METHODS_NOTES.md, checked-model wording is allowed only after a real run is recorded with the command used.

## Models

- `TenantIsolation.tla` / `.cfg` — tenant-isolation access-log invariant (stub, not checked)
- `ProvenanceLattice.tla` / `.cfg` — evidence provenance lattice: meet-based delegation admission, floor evaluation (checked 2026-07-14 with TLC 2.19; see artifacts/ProvenanceLattice.tlc.txt; distinct-state count matched the pre-registered expectation below)
- `ProvenanceLatticeMutant.tla` / `.cfg` — deliberately broken variant permitting direct assignment of the derive-only rank; exists to show the invariants are load-bearing (violation reproduced 2026-07-14; see artifacts/ProvenanceLatticeMutant.tlc.txt)
- `SpeculativeCollapse.tla` / `.cfg` — speculative-collapse rule: canonical state admits an effect only on the gateway-recorded rank, never the speculative thread's claim (checked 2026-07-14 with TLC 2.19; 529 distinct states; see artifacts/SpeculativeCollapse.tlc.txt)
- `SpeculativeCollapseMutant.tla` / `.cfg` — claim-trusting collapse, the assertion-conditioned poisoning of the reconciler; CollapseSound violation reproduced 2026-07-14 (see artifacts/SpeculativeCollapseMutant.tlc.txt)

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

## After a real run

1. Confirm the baseline artifact reports no violation and the distinct-state count matches the expectation above.
2. Confirm the mutant artifact reports the NoDeriveOnlyAssignment violation.
3. Only then update docs/research/FORMAL_METHODS_NOTES.md using its allowed wording for a checked finite model, citing both artifacts, the checker version, and the exact commands.
