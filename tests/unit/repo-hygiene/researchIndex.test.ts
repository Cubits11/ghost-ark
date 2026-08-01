import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const RESEARCH_DIR = resolve(REPO_ROOT, "docs/research");
const INDEX_PATH = resolve(RESEARCH_DIR, "RESEARCH_INDEX.json");

interface ResearchIndex {
  schema_version: string;
  tiers: Record<string, string>;
  documents: { file: string; tier: string; note: string }[];
}

const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as ResearchIndex;

/**
 * docs/research/ held 39 documents spanning formal problem statements, speculative
 * drafts, and go-to-market strategy, with nothing distinguishing them. A reviewer had
 * no way to tell which documents were load-bearing, and a speculative draft sitting
 * beside a measured result borrows unearned credibility from it.
 *
 * These tests make the classification mandatory. A new research document that nobody
 * classifies fails the suite, which is the point: the cost of adding an unclassified
 * document should be immediate and visible.
 */
describe("docs/research classification is complete and honest", () => {
  const markdownFiles = readdirSync(RESEARCH_DIR).filter((entry) => entry.endsWith(".md"));

  it("classifies every markdown document in docs/research", () => {
    const classified = new Set(index.documents.map((document) => document.file));
    const unclassified = markdownFiles.filter((file) => !classified.has(file));
    expect(unclassified, `unclassified research documents: ${unclassified.join(", ")}`).toEqual([]);
  });

  it("references no document that does not exist", () => {
    const present = new Set(markdownFiles);
    const missing = index.documents.filter((document) => !present.has(document.file)).map((document) => document.file);
    expect(missing, `index references missing files: ${missing.join(", ")}`).toEqual([]);
  });

  it("uses only declared tiers and gives every document a note", () => {
    const validTiers = new Set(Object.keys(index.tiers));
    for (const document of index.documents) {
      expect(validTiers.has(document.tier), `${document.file} has undeclared tier ${document.tier}`).toBe(true);
      expect(document.note.length, `${document.file} has no explanatory note`).toBeGreaterThan(15);
    }
  });

  it("contains no duplicate entries", () => {
    const files = index.documents.map((document) => document.file);
    expect(files.length).toBe(new Set(files).size);
  });

  it("keeps the core tier small enough to actually be read", () => {
    // A "core" tier of twenty documents is not a core tier. If the thesis needs more
    // than a handful of load-bearing documents, the thesis is not yet focused.
    const core = index.documents.filter((document) => document.tier === "core");
    expect(core.length).toBeGreaterThan(0);
    expect(core.length).toBeLessThanOrEqual(8);
  });

  it("classifies commercial material as non-research so it cannot be read as a finding", () => {
    const byFile = new Map(index.documents.map((document) => [document.file, document.tier]));
    expect(byFile.get("GHOST_ARK_GTM_STRATEGY.md")).toBe("non-research");
    expect(byFile.get("CYBER_INSURANCE_UNDERWRITING_MODEL.md")).toBe("non-research");
  });

  it("classifies documents whose own titles declare them drafts as exploratory", () => {
    const byFile = new Map(index.documents.map((document) => [document.file, document.tier]));
    for (const draft of ["GEOMETRIC_JURISPRUDENCE_DRAFT.md", "TEMPORAL_ONTOLOGY_DRAFT.md"]) {
      expect(byFile.get(draft), `${draft} is titled a draft but not classified exploratory`).toBe("exploratory");
    }
  });

  it("names the thesis and experiment documents as core", () => {
    const byFile = new Map(index.documents.map((document) => [document.file, document.tier]));
    expect(byFile.get("PROVENANCE_KERNEL_PROBLEM.md")).toBe("core");
    expect(byFile.get("00_THESIS.md")).toBe("core");
    expect(byFile.get("EXPERIMENTS.md")).toBe("core");
  });

  it("keeps the README's stated document count equal to the index", () => {
    // The index itself was already gated: every research document must be
    // classified, and that check has held. The README's PROSE count was not, and
    // it drifted to "39 research documents" while the index held 41 — a number a
    // reviewer can falsify with `ls`, in the reading map, which is the first
    // thing they open.
    //
    // A count stated in two places needs the two places tied together, not a
    // resolution to be careful.
    const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");
    const stated = readme.match(/Which of the (\d+) research documents matter\?/u);
    expect(stated, "README reading map must state the research document count").not.toBeNull();
    expect(Number((stated as RegExpMatchArray)[1])).toBe(index.documents.length);
  });

  it("keeps the README's stated core count equal to the index", () => {
    const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");
    const core = index.documents.filter((document) => document.tier === "core").length;
    const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
    expect(readme).toContain(`${words[core]} are core`);
  });
});
