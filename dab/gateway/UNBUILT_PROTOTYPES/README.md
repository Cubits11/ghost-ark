# UNBUILT PROTOTYPES — not compiled, not loaded, not load-bearing

Everything in this directory is **source text that no build system compiles and no
runtime loads.** It is kept for design provenance only.

Evidence status: **aspirational**. Not local-only, not synth-only, not AWS-live.

## Standing rules for this directory

1. Nothing here may be cited as evidence for any claim about Ghost-Ark's behavior.
2. Nothing here is referenced by `Cargo.toml`, any `build.rs`, any CI workflow, or
   any Rust module. `tests/unit/repo-hygiene/unbuiltPrototypes.test.ts` asserts this
   mechanically — if a file here ever becomes load-bearing, that test fails and forces
   it to move out of this directory.
3. Comments inside these files were written as design notes and **may assert things
   the code does not do.** Read them as intent, never as behavior.

## Contents

### `bpf/ghost_ark_ring0.bpf.c`

An eBPF prototype sketching cgroup-scoped egress validation and ring-buffer IP
extraction for the DAB gateway.

**Correction of its own header comment.** The file's banner reads "Mitigations
implemented for Zero-Days 1, 3, 4, 5." That wording is wrong and is retained only
so this correction has something to point at. Nothing in this file is implemented
in any running system:

- It has never been compiled. It `#include`s `vmlinux.h` and `bpf/bpf_helpers.h`,
  neither of which exists in this repository, so it cannot compile as checked in.
- The development host for this work is macOS, which has no eBPF. There is no CI
  runner configured to build or load it.
- No Rust code in `dab/gateway/src/` references it, loads it, or depends on any map
  or program it declares.

What the DAB gateway actually enforces at runtime is the userspace transit ledger and
nonce tombstone path in `dab/gateway/src/` — see `docs/artifact/CI_COVERAGE.md` for
which of those paths CI verifies.
