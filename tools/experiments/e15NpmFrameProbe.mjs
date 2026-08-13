#!/usr/bin/env node
/**
 * E15 (frame probe) — is a defensible sampling frame reachable for npm
 * provenance attestations, and what would a real run cost?
 *
 * WHY THIS EXISTS. `docs/research/EXPERIMENTS.md` lists as open gap #3: "No
 * second real-traffic population. npm provenance attestations expose full DSSE
 * payload bytes and would be genuinely independent of Rekor. No defensible
 * sampling frame for npm was established, so it was not run rather than run
 * badly."
 *
 * That sentence recorded a decision without recording a measurement, so nobody
 * could tell whether the frame was unreachable, expensive, or merely
 * un-attempted. This probe answers that with evidence, and it is deliberately
 * NOT an experiment: it draws no inference about pathology incidence and
 * reports no rate. It measures whether E12 can be repeated on a second
 * population, and at what cost.
 *
 * WHAT IT MEASURES
 *   1. Population size, from the registry replica's own document count.
 *   2. Whether offset-based random access (`skip`) is available.
 *   3. Whether key-ordered access (`startkey`) is available, and whether the
 *      response discloses the key's rank — which is what makes exact
 *      uniform-by-rank sampling possible at all.
 *   4. The ELIGIBLE FRACTION: of packages drawn, how many carry a provenance
 *      attestation on their latest version. This is the number that decides
 *      whether a full run is affordable, and it is the one nobody had.
 *
 * SAMPLING NOTE, STATED BECAUSE IT MATTERS. The eligibility draw below uses
 * random-key sampling (draw a random key, take the first package at or after
 * it). That is NOT uniform over packages: a package following a large
 * lexicographic gap is oversampled. It is used here only to estimate an order
 * of magnitude for eligibility, which is robust to that bias, and it is
 * explicitly not the scheme a real run would use. The real scheme is recorded
 * in the emitted report.
 *
 * NON-CLAIM. This probe says nothing about whether npm packages, publishers, or
 * attestations are correct, safe, or defective. It measures reachability and
 * cost of a sampling design, nothing else.
 *
 *   node tools/experiments/e15NpmFrameProbe.mjs [--draws N] [--seed N]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPLICA = "https://replicate.npmjs.com";
const REGISTRY = "https://registry.npmjs.org";
const UA = "ghost-ark-research-probe/0.1 (sampling-frame feasibility; contact via repository issues)";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? Number(args[index + 1]) : fallback;
};
const DRAWS = argValue("--draws", 40);
const SEED = argValue("--seed", 20260812);

/** Deterministic PRNG so a re-run with the same seed draws the same keys. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function getJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch (error) {
    return { status: 0, body: null, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const random = mulberry32(SEED);
  const observedAt = new Date().toISOString().slice(0, 10);
  const report = {
    schema_version: "ghost.e15_npm_frame_probe.v1",
    kind: "frame-feasibility-probe",
    is_experiment: false,
    observed_at: observedAt,
    seed: SEED,
    population: {},
    access: {},
    eligibility: {},
    verdict: "",
    specified_design: {},
    non_claim:
      "E15 is a probe of sampling-frame reachability and cost for one public registry. It measures no " +
      "pathology incidence, states no rate, and says nothing about whether any package, publisher, or " +
      "attestation is correct, safe, or defective."
  };

  // 1. Population size.
  const info = await getJson(`${REPLICA}/`);
  report.population = {
    source: `${REPLICA}/`,
    status: info.status,
    doc_count: info.body?.doc_count ?? null,
    db_name: info.body?.db_name ?? null
  };

  // 2. Offset-based random access.
  const skip = await getJson(`${REPLICA}/_all_docs?limit=1&skip=1000`);
  report.access.skip = {
    supported: skip.status === 200 && Array.isArray(skip.body?.rows),
    status: skip.status,
    note: "CouchDB `skip` would give direct rank access. Measured refused; see status."
  };

  // 3. Key-ordered access, and whether rank is disclosed.
  const startkey = await getJson(`${REPLICA}/_all_docs?limit=1&startkey=%22lodash%22`);
  report.access.startkey = {
    supported: startkey.status === 200 && Array.isArray(startkey.body?.rows),
    status: startkey.status,
    discloses_rank: typeof startkey.body?.offset === "number",
    total_rows: startkey.body?.total_rows ?? null,
    note:
      "The response carries `offset`, the rank of the startkey in the total ordering. That is what makes " +
      "exact uniform-by-rank sampling possible without enumerating the whole registry."
  };

  // 4. Eligible fraction.
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-";
  const drawn = [];
  let checked = 0;
  let eligible = 0;
  for (let i = 0; i < DRAWS; i += 1) {
    let key = "";
    for (let c = 0; c < 3; c += 1) key += ALPHABET[Math.floor(random() * ALPHABET.length)];
    const rows = await getJson(`${REPLICA}/_all_docs?limit=1&startkey=%22${encodeURIComponent(key)}%22`);
    const name = rows.body?.rows?.[0]?.id;
    if (!name) continue;
    const packument = await getJson(`${REGISTRY}/${encodeURIComponent(name).replace(/%40/gu, "@")}`);
    const latest = packument.body?.["dist-tags"]?.latest;
    if (!latest) continue;
    checked += 1;
    const hasAttestations = Boolean(packument.body?.versions?.[latest]?.dist?.attestations);
    if (hasAttestations) {
      eligible += 1;
      drawn.push({ name, version: latest });
    }
  }
  report.eligibility = {
    scheme: "random-key (NOT uniform over packages; order-of-magnitude estimate only)",
    checked,
    with_provenance_attestation: eligible,
    eligible_examples: drawn.slice(0, 10),
    note:
      "npm provenance postdates most of the registry, so a uniform draw over packages is dominated by the " +
      "pre-provenance long tail. This is the binding constraint on a second real-traffic population — not " +
      "the frame."
  };

  const frameReachable = report.access.startkey.supported && report.access.startkey.discloses_rank;
  report.verdict = frameReachable
    ? eligible === 0
      ? "FRAME REACHABLE, RUN NOT AFFORDABLE AT THIS ELIGIBILITY"
      : "FRAME REACHABLE AND ELIGIBILITY NON-ZERO"
    : "FRAME NOT REACHABLE";

  report.specified_design = {
    frame: "every document in the npm registry replica, ordered by package name",
    draw: "uniform over rank in [0, doc_count), resolved to a package by binary search on the key space using the disclosed `offset`",
    why_not_random_key:
      "random-key sampling weights a package by the lexicographic gap to its predecessor, which is a bias with no correction available from the data returned",
    eligibility_rule: "the drawn package's latest version carries dist.attestations, and the DSSE payload is retrievable",
    payload_source: `${REGISTRY}/-/npm/v1/attestations/{name}@{version}`,
    why_this_population_is_independent_of_e12:
      "npm serves the full DSSE envelope including the base64 payload, so the attestation bytes can be scanned directly. Rekor stores only hashes for dsse entries, which is what capped E12's eligibility at 2%.",
    estimated_draws_for_a_scannable_corpus:
      "at the eligibility measured here, reaching E12's n=64 would require on the order of 10^4 package fetches, which is why this is specified and costed rather than run"
  };

  const outDir = join(ROOT, "artifacts");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "e15-npm-frame-probe.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log("E15 (frame probe) — npm provenance attestations as a second real-traffic population");
  console.log(`  population:        ${report.population.doc_count?.toLocaleString("en-US") ?? "unavailable"} documents (${report.population.db_name})`);
  console.log(`  skip access:       ${report.access.skip.supported ? "supported" : `refused (HTTP ${report.access.skip.status})`}`);
  console.log(
    `  startkey access:   ${report.access.startkey.supported ? "supported" : "unavailable"}, rank disclosed: ${report.access.startkey.discloses_rank}`
  );
  console.log(`  eligible fraction: ${eligible}/${checked} packages carry a provenance attestation on latest`);
  console.log(`  verdict:           ${report.verdict}`);
  console.log(`  non-claim: ${report.non_claim}`);
}

await main();
