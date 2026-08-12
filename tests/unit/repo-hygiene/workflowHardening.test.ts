import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Invariants for the CI definitions themselves.
 *
 * A workflow file is the most privileged code in a repository: it runs on every
 * push, holds a token, and nobody reviews it as carefully as they review the
 * code it tests. These three properties are the ones this repository has already
 * violated or was about to.
 *
 *   1. SHA PINNING. Every action was referenced by a MUTABLE tag
 *      (`actions/checkout@v4`). A tag is repointable by whoever controls the
 *      action's repository, so a mutable tag is an unpinned dependency with
 *      write access to CI. Semgrep reported 48 instances of this and the
 *      repository carried them as an untriaged backlog.
 *
 *   2. UNTRUSTED INPUT IN A SHELL. `mutation.yml` interpolated a
 *      `workflow_dispatch` input directly into a `run:` block, splicing it into
 *      the command before the shell ever saw it. That is a shell injection this
 *      project introduced, and semgrep caught it two commits later. Untrusted
 *      context values belong in `env:`, where the shell treats them as data.
 *
 *   3. CONCURRENCY. Absent everywhere, which wastes runner minutes on
 *      superseded pull-request pushes and — on the deploy workflows — permits
 *      two CloudFormation applies against the same stacks at once.
 *
 * Assertions here are cheap and run in the normal suite; the alternative is
 * discovering all three from a runner log after the fact.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");

function workflows(): { name: string; text: string }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => ({ name, text: readFileSync(join(WORKFLOW_DIR, name), "utf8") }));
}

/**
 * The `run:` script bodies of a workflow, as (file, line, text) tuples.
 *
 * Deliberately a text scan rather than a YAML parse: the only YAML library
 * reachable here arrives transitively through aws-cdk-lib, and a hygiene guard
 * that silently stops running when an unrelated dependency is repackaged is the
 * failure mode this directory exists to prevent.
 */
function runBlocks(text: string): { line: number; body: string }[] {
  const lines = text.split("\n");
  const blocks: { line: number; body: string }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:- )?run:(.*)$/u.exec(lines[index]);
    if (!match) {
      continue;
    }
    const [, indent, rest] = match;
    const trimmed = rest.trim();

    // Inline form: `run: some-command`
    if (trimmed.length > 0 && !trimmed.startsWith("|") && !trimmed.startsWith(">")) {
      blocks.push({ line: index + 1, body: trimmed });
      continue;
    }

    // Block scalar: every following line indented deeper than the `run:` key.
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor];
      if (candidate.trim().length === 0) {
        body.push("");
        continue;
      }
      const candidateIndent = /^\s*/u.exec(candidate)?.[0].length ?? 0;
      if (candidateIndent <= indent.length) {
        break;
      }
      body.push(candidate);
    }
    blocks.push({ line: index + 1, body: body.join("\n") });
  }

  return blocks;
}

describe("workflow hardening: every action is pinned to a commit", () => {
  it("references no action by a mutable tag or branch", () => {
    const offenders: string[] = [];
    for (const { name, text } of workflows()) {
      for (const [index, line] of text.split("\n").entries()) {
        const match = /^\s*(?:- )?uses:\s*(\S+)/u.exec(line);
        if (!match) {
          continue;
        }
        const reference = match[1];
        // Actions defined inside this repository are already pinned by being
        // in the commit under test.
        if (reference.startsWith("./") || reference.startsWith("docker://")) {
          continue;
        }
        const pinned = /@[0-9a-f]{40}$/u.test(reference);
        if (!pinned) {
          offenders.push(`${name}:${index + 1}: ${reference}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a human-readable version comment beside each pin", () => {
    // A bare 40-hex SHA is unreviewable and un-updatable: Dependabot reads the
    // trailing comment to know which version the pin currently represents.
    const offenders: string[] = [];
    for (const { name, text } of workflows()) {
      for (const [index, line] of text.split("\n").entries()) {
        if (!/^\s*(?:- )?uses:\s*\S+@[0-9a-f]{40}/u.test(line)) {
          continue;
        }
        if (!/#\s*\S/u.test(line)) {
          offenders.push(`${name}:${index + 1}: pinned with no version comment`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("workflow hardening: no untrusted context reaches a shell", () => {
  it("interpolates no attacker-controllable value inside a run: block", () => {
    // GitHub's own documented untrusted set. These reach a workflow from a
    // dispatch form, a pull-request body, or a branch name, so `${{ ... }}` in a
    // `run:` block splices them into the command before the shell parses it.
    // Route them through `env:` instead, which passes them as data.
    const untrusted = /\$\{\{\s*(inputs\.|github\.event\.|github\.head_ref)/u;
    const offenders: string[] = [];
    for (const { name, text } of workflows()) {
      for (const { line, body } of runBlocks(text)) {
        const match = untrusted.exec(body);
        if (match) {
          offenders.push(`${name}: run: block at line ${line} interpolates ${match[1]}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("parses run: blocks at all (discriminator)", () => {
    // If runBlocks() returned nothing, the test above would pass vacuously —
    // a scanner that finds no shells cannot find an injection in one. Assert it
    // sees the block scalars this repository actually contains, and that it
    // would flag a planted injection.
    const found = workflows().flatMap(({ name, text }) =>
      runBlocks(text).map((block) => ({ name, ...block }))
    );
    expect(found.length).toBeGreaterThan(20);
    expect(found.some((block) => block.body.includes("npm ci"))).toBe(true);

    const planted = ["jobs:", "  a:", "    steps:", "      - run: |", "          echo ${{ inputs.x }}"].join(
      "\n"
    );
    const plantedBlocks = runBlocks(planted);
    expect(plantedBlocks).toHaveLength(1);
    expect(plantedBlocks[0].body).toContain("inputs.x");
  });
});

describe("workflow hardening: concurrency", () => {
  it("declares a concurrency group in every workflow", () => {
    const offenders = workflows()
      .filter(({ text }) => !/^concurrency:/mu.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("never cancels a deployment in progress", () => {
    // An interrupted CloudFormation apply leaves stacks in a state no later run
    // reasons about correctly, so a deploy queue must not be a cancel queue.
    for (const { name, text } of workflows()) {
      if (!name.startsWith("deploy-")) {
        continue;
      }
      const group = /^concurrency:\n(?:[ \t]+.*\n)+/mu.exec(text)?.[0] ?? "";
      expect(group, `${name} concurrency block`).toMatch(/cancel-in-progress:\s*false/u);
    }
  });
});
