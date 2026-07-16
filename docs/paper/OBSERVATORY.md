# Ghost-Ark Evidence Observatory

`observatory.html` is a self-contained, interactive companion to the
manuscript: the paper's bounds, gates, and recorded runs made explorable in a
single page. Open it directly in a browser — no build step, no network, no
external assets (all CSS/JS inline; nothing is fetched).

It is **evidence-bound**: every figure is a recorded run from repository HEAD
(see `README-AE.md` for the claim-to-command map). Two panels are *live* — they
recompute the real mathematics client-side, with nothing hard-coded:

- **The Fréchet envelope** (§4.2): drag the per-step marginal and trajectory
  length; the independence assumption always sits inside the dependence-free
  envelope the semantic gate triggers on.
- **The measured replay window** (§5.5): drag capacity `C` and tombstones `K`;
  the window follows the measured law `max(0, K − C)`.

The rest — the status strip, the three-gate pipeline with per-gate
implementation status, a real certified-receipt specimen, the TLC state counts,
the claim→evidence→command table, and the non-claims boundary — mirrors the
manuscript and `README-AE.md`.

The page is also published as a private, shareable Artifact. Regenerate the
standalone from the source with the wrapper used in
`docs/paper/OBSERVATORY.md` history, or edit `observatory.html` directly (it is
already a complete document).

## Non-claims (unchanged)

The Observatory visualizes recorded evidence and live mathematics; it does not
add any claim. Semantic safety, live-cloud behavior, production key custody,
and everything in the manuscript's "Limitations and Non-Claims" remain
non-claims here too — the boundary panel states them prominently, because the
boundary is the point.
