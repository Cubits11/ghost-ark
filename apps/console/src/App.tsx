import React, { useState } from "react";
import { ReceiptPanel } from "./pages/components/features/receipts/ReceiptPanel";
import { LineageTrace } from "./pages/components/features/lineage/LineageTrace";
import { GovernanceSummary } from "./pages/components/features/governance/GovernanceSummary";
import { ClaimsTable } from "./pages/components/features/claims/ClaimsTable";
import { VerifiedReceiptPanel } from "./pages/components/features/receipts/VerifiedReceiptPanel";
import {
  scenarios,
  scenarioOrder,
  type Scenario,
  type SeamSeverity,
  type VerifierBadges,
} from "./mockData";

type ConsoleView = "shipped" | "faithful";

const badgeRows: Array<{ key: keyof VerifierBadges; label: string }> = [
  { key: "digestRecomputed", label: "Digest recomputed" },
  { key: "signatureValid", label: "Signature valid" },
  { key: "merklePathValid", label: "Merkle path valid" },
  { key: "keyIdImmutable", label: "Key ID immutable" },
  { key: "manifestAuthenticated", label: "Manifest authenticated" },
  { key: "epochValid", label: "Epoch valid" },
  { key: "timeAnchored", label: "Time externally anchored" },
];

const severityLabel: Record<SeamSeverity, string> = {
  core: "Honest core",
  high: "High severity",
  medium: "Medium severity",
  institutional: "Institutional",
};

function Badge({ value }: { value: boolean | null }): React.ReactElement {
  if (value === null) {
    return <span className="badge badge-na">n/a</span>;
  }
  return (
    <span className={value ? "badge badge-pass" : "badge badge-fail"}>
      {value ? "PASS" : "FAIL"}
    </span>
  );
}

function ScenarioView({ scenario, view }: { scenario: Scenario; view: ConsoleView }): React.ReactElement {
  const { seam } = scenario;
  const hasFailingBadge = badgeRows.some(({ key }) => scenario.badges[key] === false);

  return (
    <div className="scenario">
      <div className={`seam seam-${seam.severity}`}>
        <div className="seam-head">
          <span className="seam-id">Fixture {seam.id}</span>
          <span className="seam-label">{seam.label}</span>
          <span className={`sev sev-${seam.severity}`}>{severityLabel[seam.severity]}</span>
        </div>
        <h2 className="seam-title">{seam.title}</h2>
        <div className="seam-grid">
          <div>
            <div className="seam-k">What the console shows</div>
            <p>{seam.uiImpression}</p>
          </div>
          <div>
            <div className="seam-k">Ground truth</div>
            <p>{seam.groundTruth}</p>
          </div>
        </div>
        <code className="seam-cite">{seam.citation}</code>
      </div>

      <div className="overlay">
        <div className="overlay-title">
          Harness overlay — verifier badges
          {hasFailingBadge ? (
            <span className="overlay-flag">the console renders no signal for the FAIL rows below</span>
          ) : null}
        </div>
        <div className="badges">
          {badgeRows.map(({ key, label }) => (
            <div className="badge-row" key={key}>
              <Badge value={scenario.badges[key]} />
              <span>{label}</span>
            </div>
          ))}
        </div>
        {scenario.wilson ? (
          <p className="wilson">
            Wilson 95% interval ({scenario.wilson.successes}/{scenario.wilson.total} failures):{" "}
            <strong>
              [{scenario.wilson.lower}, {scenario.wilson.upper}]
            </strong>{" "}
            — recomputed with the repository formula.
          </p>
        ) : null}
        {scenario.evidenceDocs ? (
          <div className="evidence">
            <div className="seam-k">Cited evidence documents</div>
            <ul>
              {scenario.evidenceDocs.map((doc) => (
                <li key={doc.path} className={doc.bytes === 0 ? "doc doc-empty" : "doc"}>
                  <code>{doc.path}</code>
                  <span className="doc-bytes">
                    {doc.bytes} bytes {doc.bytes === 0 ? "— EMPTY, masked by the table above" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="components">
        <div className="component-note">
          {view === "faithful"
            ? "Below: the verifier-faithful receipt — the same fixture, rendered with the verdict and attestation scope the shipped components omit."
            : "Below: the shipped console components, unmodified — note that a compromised seam still reads as a normal receipt."}
        </div>
        {view === "faithful" ? (
          <div className="component-grid">
            <div className="card card-wide">
              <VerifiedReceiptPanel
                receipt={scenario.receipt}
                badges={scenario.badges}
                evidenceDocs={scenario.evidenceDocs}
              />
            </div>
            <div className="card">
              <LineageTrace nodes={scenario.lineage.nodes} edges={scenario.lineage.edges} />
            </div>
            <div className="card">
              <GovernanceSummary {...scenario.governance} />
            </div>
          </div>
        ) : (
          <div className="component-grid">
            <div className="card">
              <ReceiptPanel {...scenario.receipt} />
            </div>
            <div className="card">
              <LineageTrace nodes={scenario.lineage.nodes} edges={scenario.lineage.edges} />
            </div>
            <div className="card">
              <GovernanceSummary {...scenario.governance} />
            </div>
            <div className="card card-wide">
              <ClaimsTable claims={scenario.claims} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function App(): React.ReactElement {
  const [active, setActive] = useState<Scenario["seam"]["id"]>("A");
  const [view, setView] = useState<ConsoleView>("faithful");
  const scenario = scenarios[active];

  return (
    <div className="app">
      <style>{styles}</style>
      <header className="masthead">
        <div className="brand">Ghost-Ark Console</div>
        <div className="subtitle">
          Adversarial preview harness — the honest core and the compromised seams, side by side
        </div>
        <div className="viewtoggle" role="group" aria-label="Render mode">
          <button
            type="button"
            className={view === "shipped" ? "vt vt-active" : "vt"}
            aria-pressed={view === "shipped"}
            onClick={() => setView("shipped")}
          >
            Shipped view <span className="vt-note">(masks the seam)</span>
          </button>
          <button
            type="button"
            className={view === "faithful" ? "vt vt-active" : "vt"}
            aria-pressed={view === "faithful"}
            onClick={() => setView("faithful")}
          >
            Verifier-faithful view <span className="vt-note">(shows the verdict)</span>
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Fixtures">
        {scenarioOrder.map((id) => {
          const s = scenarios[id];
          return (
            <button
              key={id}
              type="button"
              className={id === active ? "tab tab-active" : "tab"}
              aria-pressed={id === active}
              onClick={() => setActive(id)}
            >
              <span className="tab-id">{id}</span>
              <span className="tab-label">{s.seam.label}</span>
            </button>
          );
        })}
      </nav>

      <main>
        <ScenarioView scenario={scenario} view={view} />
      </main>

      <footer className="foot">
        Local dev preview · mock data only · no AWS calls · components rendered exactly as shipped so
        masking behavior is observable.
      </footer>
    </div>
  );
}

const styles = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
.app {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px;
  color: #1a1f27; line-height: 1.5;
}
.masthead { border-bottom: 2px solid currentColor; padding-bottom: 14px; margin-bottom: 18px; }
.brand { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.subtitle { font-size: 13px; opacity: 0.72; margin-top: 4px; }
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }
.tab {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  border: 1px solid rgba(120,130,150,0.4); background: rgba(130,140,160,0.06);
  border-radius: 6px; padding: 8px 12px; font: inherit; color: inherit;
}
.tab:hover { border-color: rgba(120,130,150,0.8); }
.tab-active { border-color: #2b4c74; background: rgba(43,76,116,0.12); box-shadow: inset 0 -2px 0 #2b4c74; }
.tab-id { font-weight: 700; font-size: 15px; }
.tab-label { font-size: 12px; opacity: 0.85; }
.tab:focus-visible, .tab-active:focus-visible { outline: 2px solid #2b4c74; outline-offset: 2px; }

.seam { border: 1px solid rgba(120,130,150,0.35); border-left: 4px solid #4b5464; border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; }
.seam-core { border-left-color: #1f6e57; }
.seam-high { border-left-color: #9c3a2c; }
.seam-medium { border-left-color: #94631a; }
.seam-institutional { border-left-color: #7a2e52; }
.seam-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.seam-id { font-weight: 700; }
.seam-label { opacity: 0.8; }
.sev { margin-left: auto; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; border: 1px solid currentColor; }
.sev-core { color: #1f6e57; } .sev-high { color: #9c3a2c; } .sev-medium { color: #94631a; } .sev-institutional { color: #7a2e52; }
.seam-title { font-size: 18px; margin: 10px 0 12px; }
.seam-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.seam-k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; margin-bottom: 4px; }
.seam-grid p { margin: 0; font-size: 13.5px; }
.seam-cite { display: block; margin-top: 12px; font-size: 11.5px; opacity: 0.7; word-break: break-all; }

.overlay { border: 1px dashed rgba(120,130,150,0.5); border-radius: 8px; padding: 16px 18px; margin-bottom: 16px; background: rgba(130,140,160,0.05); }
.overlay-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.75; margin-bottom: 12px; display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; }
.overlay-flag { text-transform: none; letter-spacing: 0; color: #9c3a2c; font-weight: 600; }
.badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 18px; }
.badge-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.badge { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 4px; min-width: 46px; text-align: center; }
.badge-pass { background: rgba(31,110,87,0.16); color: #1f6e57; border: 1px solid #1f6e57; }
.badge-fail { background: rgba(156,58,44,0.16); color: #9c3a2c; border: 1px solid #9c3a2c; }
.badge-na { background: rgba(120,130,150,0.12); color: #6a7484; border: 1px solid rgba(120,130,150,0.5); }
.wilson { font-size: 13px; margin: 12px 0 0; }
.evidence { margin-top: 14px; }
.evidence ul { list-style: none; padding: 0; margin: 6px 0 0; }
.doc { display: flex; gap: 10px; flex-wrap: wrap; align-items: baseline; padding: 4px 0; font-size: 13px; }
.doc-empty { color: #9c3a2c; }
.doc-bytes { font-size: 12px; opacity: 0.85; }

.components { margin-top: 6px; }
.component-note { font-size: 12px; opacity: 0.65; margin-bottom: 10px; }
.component-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.card { border: 1px solid rgba(120,130,150,0.3); border-radius: 8px; padding: 14px 16px; overflow-x: auto; background: rgba(255,255,255,0.5); }
.card-wide { grid-column: 1 / -1; }
.card h2 { font-size: 15px; margin: 0 0 10px; }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; font-size: 13px; }
.card dt { opacity: 0.6; } .card dd { margin: 0; word-break: break-all; }
.card ol, .card ul { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }
.card table { width: 100%; border-collapse: collapse; font-size: 13px; }
.card th, .card td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(120,130,150,0.25); vertical-align: top; }
.card th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
.card td p { margin: 4px 0 0; opacity: 0.8; }

.foot { margin-top: 28px; padding-top: 14px; border-top: 1px solid rgba(120,130,150,0.3); font-size: 11.5px; opacity: 0.65; }

.viewtoggle { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.vt { cursor: pointer; font: inherit; color: inherit; border: 1px solid rgba(120,130,150,0.4); background: rgba(130,140,160,0.06); border-radius: 6px; padding: 7px 12px; font-size: 13px; }
.vt:hover { border-color: rgba(120,130,150,0.8); }
.vt-active { border-color: #2b4c74; background: rgba(43,76,116,0.12); box-shadow: inset 0 -2px 0 #2b4c74; }
.vt-note { opacity: 0.6; font-size: 11px; }
.vt:focus-visible { outline: 2px solid #2b4c74; outline-offset: 2px; }

.vfp { border: 1px solid rgba(120,130,150,0.35); border-radius: 8px; padding: 0; overflow: hidden; }
.vfp-ok { border-color: #1f6e57; }
.vfp-bad { border-color: #9c3a2c; }
.vfp-muted { border-color: rgba(120,130,150,0.5); }
.vfp-banner { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid rgba(120,130,150,0.25); }
.vfp-ok .vfp-banner { background: rgba(31,110,87,0.12); }
.vfp-bad .vfp-banner { background: rgba(156,58,44,0.13); }
.vfp-muted .vfp-banner { background: rgba(130,140,160,0.08); }
.vfp-verdict { font-family: var(--mono); font-weight: 700; font-size: 13px; letter-spacing: 0.06em; }
.vfp-ok .vfp-verdict { color: #1f6e57; }
.vfp-bad .vfp-verdict { color: #9c3a2c; }
.vfp-muted .vfp-verdict { color: #6a7484; }
.vfp-blurb { font-size: 12.5px; opacity: 0.8; }
.vfp-failing { padding: 12px 16px 4px; }
.vfp-failing ul { margin: 6px 0 8px; padding-left: 18px; font-size: 13px; }
.vfp-bad .vfp-failing li { color: #9c3a2c; }
.vfp-k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; opacity: 0.6; }
.vfp-k-ok { color: #1f6e57; opacity: 0.9; }
.vfp-k-bad { color: #9c3a2c; opacity: 0.9; }
.vfp-panel-wrap { padding: 4px 16px 8px; }
.vfp-panel-wrap h2 { font-size: 15px; margin: 8px 0; }
.vfp-panel-wrap dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; font-size: 13px; }
.vfp-panel-wrap dt { opacity: 0.6; } .vfp-panel-wrap dd { margin: 0; word-break: break-all; }
.vfp-scope { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: rgba(120,130,150,0.25); border-top: 1px solid rgba(120,130,150,0.25); }
.vfp-scope-col { background: var(--vfp-scope-bg, rgba(255,255,255,0.4)); padding: 12px 16px; }
.vfp-scope-col ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; }
.vfp-scope-col li { margin-bottom: 4px; opacity: 0.85; }

@media (prefers-color-scheme: dark) {
  .vfp-ok .vfp-verdict { color: #4cb392; }
  .vfp-bad .vfp-verdict { color: #de7766; }
  .vfp-bad .vfp-failing li { color: #de7766; }
  .vfp-k-ok { color: #4cb392; } .vfp-k-bad { color: #de7766; }
  .vfp-scope-col { --vfp-scope-bg: rgba(255,255,255,0.03); }
  .vt-active { border-color: #82a8d8; box-shadow: inset 0 -2px 0 #82a8d8; }
}

@media (max-width: 720px) {
  .seam-grid, .component-grid { grid-template-columns: 1fr; }
}
@media (prefers-color-scheme: dark) {
  .app { color: #e7eaf0; }
  .card { background: rgba(255,255,255,0.03); }
  .sev-core { color: #4cb392; } .sev-high { color: #de7766; } .sev-medium { color: #d3a552; } .sev-institutional { color: #c88cab; }
  .seam-core { border-left-color: #4cb392; } .seam-high { border-left-color: #de7766; } .seam-medium { border-left-color: #d3a552; } .seam-institutional { border-left-color: #c88cab; }
  .badge-pass { color: #4cb392; border-color: #4cb392; }
  .badge-fail { color: #de7766; border-color: #de7766; }
  .overlay-flag { color: #de7766; }
  .doc-empty { color: #de7766; }
  .tab-active { border-color: #82a8d8; box-shadow: inset 0 -2px 0 #82a8d8; }
}
`;
