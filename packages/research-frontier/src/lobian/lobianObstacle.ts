// The Löbian obstacle, instantiated as an agent-licensing decision.
//
// Setting: an agent A must decide whether to license a successor A' that reasons
// at the same proof strength, on the basis that A' preserves a safety invariant
// φ. Read □ψ as "A' proves ψ". Three obligations an operator might demand:
//
//   1. naive soundness  □φ → φ   ("if the successor proves the invariant, it holds")
//   2. consistency      ¬□⊥       ("the successor never proves a contradiction")
//   3. Löbian self-trust □(□φ→φ) → □φ   (Löb's axiom for the invariant)
//
// GL's verdicts are the obstacle itself:
//   (1) is REFUTED — □φ→φ is the T axiom, false on GL frames. An agent cannot
//       license a same-strength successor by demanding provable soundness.
//   (2) is REFUTED — ¬□⊥ is Gödel's second theorem: A' cannot certify its own
//       consistency. So neither can A certify it of A'.
//   (3) is a THEOREM — but note what it certifies: □(□φ→φ)→□φ collapses trusting
//       your own soundness into mere provability □φ, NOT the invariant φ. Trust
//       in one's proofs buys provability, never truth.
//
// Ghost-Ark's response is not to fake the missing proof but to RECORD the
// refutation: the countermodel is a finite, replayable witness of exactly why
// the licensing proof fails. Evidence over proof.

import {
  type Formula,
  BOT,
  box,
  imp,
  not,
  show,
} from "./formula";
import { type KripkeModel } from "./kripke";
import { type Proof, decideChecked } from "./glTableau";

export type ObligationKind = "naive-soundness" | "consistency" | "loeb-self-trust";

export interface LicensingObligation {
  readonly kind: ObligationKind;
  readonly invariant: Formula;
  /** The modal formula A must prove to license A' under this reading. */
  readonly formula: Formula;
  readonly description: string;
}

/** The three canonical obligations for a given safety invariant φ. */
export function licensingObligations(invariant: Formula): LicensingObligation[] {
  return [
    {
      kind: "naive-soundness",
      invariant,
      formula: imp(box(invariant), invariant),
      description: `Demand that the successor's proof of "${show(invariant)}" implies its truth (□φ→φ).`,
    },
    {
      kind: "consistency",
      invariant,
      formula: not(box(BOT)),
      description: "Demand that the successor never proves a contradiction (¬□⊥).",
    },
    {
      kind: "loeb-self-trust",
      invariant,
      formula: imp(box(imp(box(invariant), invariant)), box(invariant)),
      description: `Löbian self-trust for "${show(invariant)}" (□(□φ→φ)→□φ).`,
    },
  ];
}

export type Verdict =
  | {
      readonly status: "LICENSE_CERTIFIED";
      readonly obligation: LicensingObligation;
      readonly proof: Proof;
      readonly note: string;
    }
  | {
      readonly status: "LICENSE_REFUTED";
      readonly obligation: LicensingObligation;
      readonly countermodel: KripkeModel;
      readonly root: string;
      readonly note: string;
    };

const NOTES: Record<ObligationKind, { certified: string; refuted: string }> = {
  "naive-soundness": {
    certified: "unexpected: □φ→φ certified (would make GL the trivial logic).",
    refuted:
      "The Löbian obstacle: provable soundness of a same-strength successor is unattainable. Recorded, not licensed.",
  },
  consistency: {
    certified: "unexpected: ¬□⊥ certified (would violate Gödel's second theorem).",
    refuted:
      "Gödel G2: the successor's consistency is not provable. The obligation is recorded as refuted evidence.",
  },
  "loeb-self-trust": {
    certified:
      "Löb's theorem holds — but it certifies only □φ (provability), never φ (truth). Self-trust buys provability, not soundness.",
    refuted: "unexpected: Löb's axiom refuted (contradicts GL completeness).",
  },
};

/** Decide one obligation; the countermodel is self-checked inside decideChecked. */
export function evaluateObligation(o: LicensingObligation): Verdict {
  const r = decideChecked(o.formula);
  if (r.theorem) {
    return { status: "LICENSE_CERTIFIED", obligation: o, proof: r.proof, note: NOTES[o.kind].certified };
  }
  return {
    status: "LICENSE_REFUTED",
    obligation: o,
    countermodel: r.countermodel,
    root: r.root,
    note: NOTES[o.kind].refuted,
  };
}

export interface ObstacleReport {
  readonly invariant: Formula;
  readonly verdicts: Verdict[];
  /** True iff at least one obligation is refuted — i.e., the obstacle bites. */
  readonly obstacleHit: boolean;
}

/** Run all three obligations for a named invariant and summarize. */
export function demonstrateLobianObstacle(invariant: Formula): ObstacleReport {
  const verdicts = licensingObligations(invariant).map(evaluateObligation);
  return {
    invariant,
    verdicts,
    obstacleHit: verdicts.some((v) => v.status === "LICENSE_REFUTED"),
  };
}
