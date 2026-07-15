# Ghost-Ark Dissertation — Build

The monograph is authored as ordered Markdown chapters and compiled to a single
LaTeX/PDF document.

## Chapters

`00_*.md` … `10_*.md` (abstract → theory → DAB → formal model → empirical →
roadmap → formal verification → IFC/provenance → conclusion → artifact appendix →
policy/confused-deputy addendum). They are discovered and concatenated in
lexical order.

## Build

```bash
./build_paper.sh
```

Outputs (in this directory):

- `ghost-ark-usenix.tex` — standalone LaTeX
- `ghost-ark-usenix.pdf` — compiled PDF

### Requirements

- `pandoc`
- `latexmk` + a TeX Live install

Both are preinstalled in `Dockerfile.reviewer`. If you do not have them locally:

```bash
# from the repo root
docker compose -f docker-compose.reviewer.yml run --rm reviewer make dissertation
```

## Claim gate (fail-closed)

Before emitting anything, `build_paper.sh` runs the Ghost-Ark forbidden-claims
scanner (`tools/research/check-forbidden-claims.mjs`) over the chapters. **If the
prose contains assurance language outside the Ghost-Ark claim boundary, the build
stops and prints the violations.** It does not edit the prose and it does not
produce a PDF.

> Status at the time of writing: the claim gate is **RED**. The committed
> chapters use absolute-assurance phrasing outside the claim boundary that the
> scanner flags (run `npm run scan:claims` for the exact lines; see also
> `docs/artifact/repository_inventory.md` §7.3).
> Bring the prose
> within the boundary (`docs/compliance/non-claims.md`) before a review build.
> `GHOST_DISS_ALLOW_OVERCLAIM=1 ./build_paper.sh` produces a **clearly watermarked
> author draft** for internal editing only — never for submission.

## Claim boundary

The PDF describes a research artifact. Ghost-Ark verifies recorded, signed,
policy-bounded, replayable bindings under Ghost-Ark verifier rules. It does not
prove semantic safety, truth, compliance, alignment, production readiness, or
deployment correctness. Note in particular that the DAB `NoReplays` formal claim
in Chapter 6 is **not** currently supported by a runnable model (see the
repository inventory §7.1–7.2); that must be resolved before the corresponding
prose can stand.
