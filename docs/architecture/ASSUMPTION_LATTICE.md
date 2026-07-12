# Assumption Lattice and Maturity Enforcement (`npm run assumptions`)

Status: RESEARCH tooling. This is the enforcement half of Phase III plus Phase IV:
maturity separation is made **executable** rather than expressed only by directory
names. Naming implies nothing; the check is what binds.

## Why

A module can be labelled PRODUCTION in a comment and still rest on an assumption
that does not hold, or import a lower-assurance module. Labels and directories do
not catch that. `npm run assumptions` does: it reads the annotations, propagates
assumptions across the import graph, and fails the build when a module claims more
assurance than its assumptions and dependencies support.

## Annotating a module

A module opts in by exporting two constants:

```ts
export const MATURITY = "RESEARCH";            // "PRODUCTION" | "RESEARCH" | "SYNTH_ONLY"
export const ASSUMPTIONS = ["A_APPEND_ONLY_LOG"]; // ids that must hold for that maturity
```

`ASSUMPTIONS` lists the assumptions the module's declared maturity **relies on**.
Every id must appear in `tools/assumptions/registry.json`.

## The lattice

Maturity tiers, low to high: `SYNTH_ONLY < RESEARCH < PRODUCTION`.
Assumption status, low to high: `UNMET < PARTIAL < HELD`.

A status caps the maturity it can support, rank for rank:

| status  | caps maturity at |
|---------|------------------|
| UNMET   | SYNTH_ONLY       |
| PARTIAL | RESEARCH         |
| HELD    | PRODUCTION       |

The enforced rule, computed over the transitive closure of a module's annotated
imports:

```
Assurance(module) <= min(
  statusCap(a)   for a in transitive assumptions,
  maturity(dep)  for dep in transitive annotated dependencies
)
```

A module whose declared `MATURITY` exceeds that bound is a **violation** (build
failure), as is any reference to an assumption absent from the registry.

## Registry

`tools/assumptions/registry.json` (schema:
`schemas/ghostark.assumptions.registry.v1.json`) is the single source of truth for
assumption status and rationale. Moving an assumption from `PARTIAL` to `HELD`
requires evidence recorded in its rationale; the check does not read intent.

## Current state (honest)

| module | declared | cap | why |
|---|---|---|---|
| `authenticatedRevocation.ts` | RESEARCH | RESEARCH | rests on PARTIAL witness assumptions |
| `ledgerAnchoredRevocation.ts` | SYNTH_ONLY | SYNTH_ONLY | rests on the UNMET `A_CALLER_SUPPLIED_ORDERING_UNAUTHENTICATED` |

No module currently declares PRODUCTION, so nothing over-claims. The tests in
`tests/unit/tools/assumptionsEngine.test.ts` prove the check **would** fail a
PRODUCTION module that rested on an UNMET assumption or imported a RESEARCH module.

## Deliberate limits (what this does not do)

- Only **annotated** modules participate. An unannotated dependency does not lower
  a module's cap; extending the propagation to unannotated source is future work.
- Parsing is static and regex-based over the declared export form, not a full type
  check of the constant's value.
- The physical Phase III move into `/production`, `/research`, `/aws_assumptions`,
  `/theorem_claims` is intentionally deferred: it is a cosmetic reorganization that
  would rewrite every import path, whereas this check enforces the same separation
  logically. The move can follow once annotations are broad.

## Non-claim

This tool checks declared maturity against declared assumptions and the annotated
import graph. It does not prove any assumption actually holds, does not verify the
correctness of the modules, and is not a substitute for review. A green run means
no annotated module over-claims relative to the registry — nothing more.
