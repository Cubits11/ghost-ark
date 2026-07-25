/**
 * THE FORK GUARD.
 *
 * The published glasshouse page is a single self-contained HTML file with its
 * verification logic hand-inlined (a strict CSP forbids external scripts, and
 * the page must run with zero network). That means it is a FORK of
 * `apps/glasshouse/lib/*.ts` — and an adversarial review established the
 * consequence bluntly: the differential tests were not testing what ships. Every
 * defect fixed in `lib/` survived in the artifact, including the exact
 * `indexOf("PROVED")` prefix test the README forbids.
 *
 * This test extracts the artifact's own inlined functions and runs the same
 * vectors against them, so the two implementations cannot silently diverge on
 * the properties that matter. It fails loudly if the artifact regresses on a
 * rule the library enforces.
 *
 * If ARTIFACT_HTML is absent (a fresh clone without the scratchpad build), the
 * suite skips rather than passing vacuously — a skipped guard is honest, a
 * green one that checked nothing is not.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ARTIFACT_HTML =
  process.env.GLASSHOUSE_ARTIFACT_HTML ??
  "/private/tmp/claude-501/-Users-pranavbhave-Documents-GitHub-ghost-ark/53da74fe-9ac1-46fa-8231-baa3b29469cc/scratchpad/glasshouse.html";

const available = existsSync(ARTIFACT_HTML);

/** Extracts the artifact's inlined engine into an importable ES module. */
async function loadArtifactEngine(): Promise<Record<string, any>> {
  const html = readFileSync(ARTIFACT_HTML, "utf-8");
  const script = html.split("<script>")[1].split("</script>")[0];
  const head = script.split("// ============================ RECORDS UI")[0];
  const preimageMarker = "// ============================ PREIMAGE INSPECTOR (Myers O(ND)) ============================";
  const preimage = script.includes(preimageMarker)
    ? script.split(preimageMarker)[1].split("let pTimer")[0]
    : "";
  const body = `${head}\n${preimage}\nexport { verifyRecord, verifyDecision, verifyLineage, canon, RECEIPT, RKEY, RTENANT, RKEYID, BASE, CHAIN, CHAIN3, MHASH, MHKEY, HMAC_SECRET };\n${
    preimage ? "export { myersDiff, describeTransforms };\n" : ""
  }`;
  const dir = mkdtempSync(join(tmpdir(), "glasshouse-parity-"));
  const file = join(dir, "engine.mjs");
  writeFileSync(file, body);
  return import(pathToFileURL(file).href);
}

describe.skipIf(!available)("artifact parity — the shipped page enforces the same rules as lib/", () => {
  it("record: the real sample receipt verifies", async () => {
    const m = await loadArtifactEngine();
    const rep = await m.verifyRecord(m.RECEIPT, { publicKeyPem: m.RKEY, tenant: m.RTENANT, expectedKeyId: m.RKEYID });
    expect(rep.verdict).toBe("PASS");
  });

  it("HONEST DESIGN RULE: HMAC is PASS_DEV_SYMMETRIC in the artifact too, never PASS", async () => {
    const m = await loadArtifactEngine();
    const rep = await m.verifyDecision(m.BASE, { hmacSecret: m.HMAC_SECRET });
    expect(rep.verdict).toBe("PASS_DEV_SYMMETRIC");
    expect(rep.verdict).not.toBe("PASS");
  });

  it("KMS digest-as-mhash verifies via the artifact's BigInt engine", async () => {
    const m = await loadArtifactEngine();
    const rep = await m.verifyDecision(m.MHASH, { publicKeyPem: m.MHKEY, pssMode: "digest-as-mhash" });
    expect(rep.verdict).toBe("PASS");
  });

  it("a tampered KMS signature is FAIL in the artifact, never UNVERIFIABLE", async () => {
    const m = await loadArtifactEngine();
    const env = JSON.parse(Buffer.from(m.MHASH.receipt_signature, "base64").toString("utf-8"));
    const i = env.signature.length >> 1;
    env.signature = env.signature.slice(0, i) + (env.signature[i] === "A" ? "B" : "A") + env.signature.slice(i + 1);
    const forged = { ...m.MHASH, receipt_signature: Buffer.from(JSON.stringify(env)).toString("base64") };
    const rep = await m.verifyDecision(forged, { publicKeyPem: m.MHKEY, pssMode: "digest-as-mhash" });
    expect(rep.verdict, "a detected tamper must not be excused as a build limitation").toBe("FAIL");
  });

  it("lineage: a dev-HMAC chain reports the DEV_SYMMETRIC tier, not bare emerald validity", async () => {
    const m = await loadArtifactEngine();
    const g = await m.verifyLineage([m.BASE, m.CHAIN, m.CHAIN3], { hmacSecret: m.HMAC_SECRET });
    expect(g.nodes.every((n: any) => n.verdict === "PROVED_HMAC_DEV")).toBe(true);
    // The renderer must be able to reach the amber tier from the graph result.
    expect(g.weakestNodeTier, "graph must expose the weakest tier, not just a boolean").toBe("DEV_SYMMETRIC");
  });

  it("lineage: a re-pointed link is caught in the artifact", async () => {
    const m = await loadArtifactEngine();
    const broken = JSON.parse(JSON.stringify(m.CHAIN3));
    broken.prev_receipt_hash = "sha256:" + "0".repeat(64);
    const g = await m.verifyLineage([m.BASE, m.CHAIN, broken], { hmacSecret: m.HMAC_SECRET });
    expect(g.valid).toBe(false);
  });

  it("the artifact's canonicalizer agrees byte-for-byte with lib/", async () => {
    const m = await loadArtifactEngine();
    const { canonicalize } = await import("../../apps/glasshouse/lib/webReceiptVerifier");
    expect(m.canon(m.RECEIPT.payload)).toBe(canonicalize(m.RECEIPT.payload));
  });

  it("the artifact's preimage summary never claims byte-identity when bytes differ", async () => {
    const m = await loadArtifactEngine();
    if (!m.describeTransforms) return; // preimage tab not present in this build
    for (const raw of ['{"a":{"z":1,"y":2}}', '{"a":"\\u0041"}', '{"a":1,"a":2}']) {
      const canonical = m.canon(JSON.parse(raw));
      if (raw === canonical) continue;
      const msg = m.describeTransforms(raw, canonical).join(" ");
      expect(msg, `artifact claimed identity for ${raw}`).not.toMatch(/byte-identical|already in canonical/i);
    }
  });

  it("the artifact does not use the forbidden PROVED-prefix tier test", async () => {
    const html = readFileSync(ARTIFACT_HTML, "utf-8");
    // Rendering must distinguish PROVED_HMAC_DEV explicitly before any prefix test.
    const usesPrefixForRendering = /const\s+cls\s*=\s*n\.verdict\.indexOf\("PROVED"\)===0\s*\?\s*"proved"/.test(html);
    expect(usesPrefixForRendering, "a bare PROVED-prefix test relaunders HMAC as KMS").toBe(false);
  });
});
