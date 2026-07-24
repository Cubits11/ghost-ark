/**
 * Surface 2 — the Adversarial Mutation Workbench.
 *
 * A client-side, zero-server security demonstration: it runs the REAL browser
 * verifier (webReceiptVerifier.ts, on crypto.subtle) over the real sample
 * receipt and real corpus-mapped mutations. Emerald renders ONLY when the
 * signature actually verifies in the viewer's browser — no scripted checkmarks.
 * See tests/differential/webVerifierAgreement.test.ts: the engine behind every
 * pixel here is CI-covered.
 *
 * Framework-agnostic React (no external UI deps), inline styles so it drops
 * into any Next/Vite app. Design tokens follow the "no unproven pixels"
 * palette: emerald = signature-verified, amber = asserted/skipped, rose =
 * rejected.
 */

import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { verifyReceiptRecordWeb, canonicalize, type VerifyReport } from "./lib/webReceiptVerifier";
import { MUTATIONS, type Mutation } from "./lib/mutations";

const COLORS = {
  bg: "#09090B",
  panel: "#111114",
  border: "#27272A",
  text: "#E4E4E7",
  dim: "#71717A",
  emerald: "#10B981",
  amber: "#F59E0B",
  rose: "#EF4444",
  mono: "'JetBrains Mono','Fira Code',ui-monospace,SFMono-Regular,Menlo,monospace",
};

export interface MutationWorkbenchProps {
  /** The receipt record to audit. */
  receipt: unknown;
  /** SPKI PEM of the signing public key. */
  publicKeyPem: string;
  /** Expected tenant slug (consumer boundary). */
  tenant?: string;
  /** Expected immutable KMS key id. */
  expectedKeyId?: string;
}

function stepColor(passed: boolean): string {
  return passed ? COLORS.emerald : COLORS.rose;
}

/** First index where two strings diverge, for the canonical diff highlight. */
function firstDivergence(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

export function MutationWorkbench(props: MutationWorkbenchProps): React.JSX.Element {
  const { receipt, publicKeyPem, tenant, expectedKeyId } = props;
  const [selectedId, setSelectedId] = useState<string>("CLEAN");
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [loaderError, setLoaderError] = useState<string | null>(null);

  const mutation: Mutation = useMemo(
    () => MUTATIONS.find((m) => m.id === selectedId) ?? MUTATIONS[0],
    [selectedId],
  );

  const cleanCanonical = useMemo(() => {
    try {
      return canonicalize((receipt as { payload: unknown }).payload);
    } catch {
      return "";
    }
  }, [receipt]);

  const mutatedValue = useMemo(() => mutation.apply(receipt), [mutation, receipt]);

  const mutatedCanonical = useMemo(() => {
    if (typeof mutatedValue !== "object" || mutatedValue === null) return null;
    try {
      return canonicalize((mutatedValue as { payload: unknown }).payload);
    } catch {
      return null;
    }
  }, [mutatedValue]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setLoaderError(null);
    (async () => {
      try {
        const report = await verifyReceiptRecordWeb(mutatedValue, {
          publicKeyPem,
          tenant: mutation.options?.tenant ?? tenant,
          expectedKeyId: mutation.options?.expectedKeyId ?? expectedKeyId,
        });
        if (!cancelled) setReport(report);
      } catch (e) {
        if (!cancelled) {
          setLoaderError(e instanceof Error ? e.message : String(e));
          setReport(null);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mutatedValue, mutation, publicKeyPem, tenant, expectedKeyId]);

  const divergeAt = mutatedCanonical === null ? -1 : firstDivergence(cleanCanonical, mutatedCanonical);
  const verdict = report?.verdict ?? "FAIL";
  const signaturePassed = report?.checks.find((c) => c.name === "signature")?.passed ?? false;
  const badgeColor = verdict === "PASS" && signaturePassed ? COLORS.emerald : COLORS.rose;

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, fontFamily: COLORS.mono, padding: 24, borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Adversarial Mutation Workbench</div>
          <div style={{ color: COLORS.dim, fontSize: 12 }}>
            Client-side verification via Web Crypto. Emerald renders only when the signature verifies in your browser.
          </div>
        </div>
        <span
          role="status"
          style={{ padding: "6px 14px", borderRadius: 999, border: `1px solid ${badgeColor}`, color: badgeColor, fontWeight: 700, letterSpacing: 1 }}
        >
          {busy ? "VERIFYING…" : verdict === "PASS" ? "VERIFIED" : "FAIL-CLOSED"}
        </span>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="mutation" style={{ color: COLORS.dim, fontSize: 12 }}>
          Attack vector
        </label>
        <select
          id="mutation"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ background: COLORS.panel, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 10px", fontFamily: COLORS.mono, fontSize: 13 }}
        >
          {MUTATIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} · {m.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Pane title="Canonical payload (recorded)">
          <CanonicalView text={cleanCanonical} divergeAt={-1} />
        </Pane>
        <Pane title={mutation.id === "CLEAN" ? "Canonical payload (identical)" : "Canonical payload (after mutation)"}>
          {mutatedCanonical === null ? (
            <div style={{ color: COLORS.rose }}>
              {loaderError ? `Loader rejected input: ${loaderError}` : "Input is not a canonicalizable receipt (loader boundary)."}
            </div>
          ) : (
            <CanonicalView text={mutatedCanonical} divergeAt={divergeAt} />
          )}
        </Pane>
      </div>

      <Pane title="Verifier pipeline (client-side, Web Crypto)" style={{ marginTop: 12 }}>
        {report ? (
          report.checks.map((c) => (
            <div key={c.name} style={{ display: "flex", gap: 10, padding: "4px 0", alignItems: "baseline" }}>
              <span style={{ color: stepColor(c.passed), width: 18 }}>{c.passed ? "✓" : "✗"}</span>
              <span style={{ width: 110, color: COLORS.dim }}>{c.name}</span>
              <span style={{ color: c.passed ? COLORS.text : COLORS.rose }}>{c.detail}</span>
            </div>
          ))
        ) : (
          <div style={{ color: COLORS.amber }}>{loaderError ?? "No report."}</div>
        )}
      </Pane>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}`, color: COLORS.dim, fontSize: 11, lineHeight: 1.6 }}>
        A PASS proves internal receipt consistency under this verifier's rules (canonical identity, digest binding,
        tenant/key expectation, RSA-PSS signature). It does not prove model safety, semantic truth, compliance, AWS
        execution, KMS custody, or runtime integrity. Canonicalization is Ghost-Ark canonical JSON, not RFC 8785.
      </div>
    </div>
  );
}

function Pane(props: { title: string; children: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, ...props.style }}>
      <div style={{ color: COLORS.dim, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{props.title}</div>
      {props.children}
    </div>
  );
}

function CanonicalView(props: { text: string; divergeAt: number }): React.JSX.Element {
  const { text, divergeAt } = props;
  if (divergeAt < 0) {
    return <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11, lineHeight: 1.5 }}>{text}</pre>;
  }
  const before = text.slice(0, divergeAt);
  const after = text.slice(divergeAt);
  return (
    <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11, lineHeight: 1.5 }}>
      {before}
      <mark style={{ background: "#7F1D1D", color: "#FECACA", padding: "0 1px" }}>{after.slice(0, 24)}</mark>
      {after.slice(24)}
    </pre>
  );
}
