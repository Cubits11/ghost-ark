import React from "react";
import { ReceiptPanel, type ReceiptPanelProps } from "./ReceiptPanel";
import { evaluateReceiptVerdict } from "../../../../verdict";
import type { EvidenceDoc, VerifierBadges } from "../../../../mockData";

/**
 * A verifier-faithful wrapper around the shipped ReceiptPanel. It does not
 * modify the panel — it renders the panel's masked output beneath an honest
 * verdict banner, the failing checks, and an explicit attestation-scope box, so
 * a reader who never runs the CLI still sees whether the receipt verified and
 * what it does (and does not) attest.
 */

const VERDICT_COPY = {
  verified: { label: "VERIFIED", tone: "ok", blurb: "Every critical check was recomputed and passed." },
  compromised: { label: "COMPROMISED SEAM", tone: "bad", blurb: "The receipt is self-reported as issued, but a critical check failed." },
  incomplete: { label: "INCOMPLETE", tone: "muted", blurb: "Not verified — one or more critical checks were not evaluated." },
  documentation_only: { label: "DOCUMENTATION ONLY", tone: "muted", blurb: "No verifiable receipt backs this row." },
} as const;

export function VerifiedReceiptPanel(props: {
  receipt: ReceiptPanelProps;
  badges: VerifierBadges;
  evidenceDocs?: EvidenceDoc[];
}): React.ReactElement {
  const info = evaluateReceiptVerdict(props.badges);
  const copy = VERDICT_COPY[info.verdict];
  const emptyDocs = (props.evidenceDocs ?? []).filter((doc) => doc.bytes === 0);

  return (
    <section aria-label="Verifier-faithful receipt" className={`vfp vfp-${copy.tone}`}>
      <div className="vfp-banner">
        <span className="vfp-verdict">{copy.label}</span>
        <span className="vfp-blurb">{copy.blurb}</span>
      </div>

      {info.failing.length > 0 ? (
        <div className="vfp-failing">
          <div className="vfp-k">Failed checks the shipped view hides</div>
          <ul>
            {info.failing.map((check) => (
              <li key={check.key}>{check.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {info.unevaluated.length > 0 ? (
        <div className="vfp-failing">
          <div className="vfp-k">Critical checks not evaluated</div>
          <ul>
            {info.unevaluated.map((check) => (
              <li key={check.key}>{check.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {emptyDocs.length > 0 ? (
        <div className="vfp-failing">
          <div className="vfp-k">Cited evidence is empty</div>
          <ul>
            {emptyDocs.map((doc) => (
              <li key={doc.path}>
                <code>{doc.path}</code> — {doc.bytes} bytes
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="vfp-panel-wrap">
        <ReceiptPanel {...props.receipt} />
      </div>

      <div className="vfp-scope">
        <div className="vfp-scope-col">
          <div className="vfp-k vfp-k-ok">This receipt attests</div>
          <ul>
            {info.attests.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="vfp-scope-col">
          <div className="vfp-k vfp-k-bad">It does NOT attest</div>
          <ul>
            {info.doesNotAttest.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
