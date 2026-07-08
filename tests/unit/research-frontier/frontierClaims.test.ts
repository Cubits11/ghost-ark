import { describe, expect, it } from "vitest";
import {
  type FrontierManifest,
  validateFrontierManifestSemantics,
} from "../../../packages/research-frontier/src/frontierClaims";

const fortyCharGitSha = "a".repeat(40);
const sixtyFourCharSha = "b".repeat(64);

describe("frontier manifest semantic validation", () => {
  it("accepts experimental claims without evidence", () => {
    const manifest: FrontierManifest = {
      schema_version: "ghostark.research.frontier_manifest.v1",
      artifact_id: "ghost-ark-frontier-dev",
      git_commit: fortyCharGitSha,
      claims: [
        {
          id: "phase-a-nitro-experimental",
          phase: "phase_a",
          statement:
            "Ghost-Ark is experimenting with Nitro attestation for governed execution.",
          status: "experimental",
        },
      ],
      non_claims: [
        "This does not prove model safety.",
        "This does not prove full formal correctness.",
      ],
      evidence: [],
    };

    expect(() => validateFrontierManifestSemantics(manifest)).not.toThrow();
  });

  it("rejects verified claims without evidence", () => {
    const manifest: FrontierManifest = {
      schema_version: "ghostark.research.frontier_manifest.v1",
      artifact_id: "ghost-ark-frontier-dev",
      git_commit: fortyCharGitSha,
      claims: [
        {
          id: "phase-d-verified",
          phase: "phase_d",
          statement: "Witness checkpoints are verified.",
          status: "verified",
        },
      ],
      non_claims: [],
      evidence: [],
    };

    expect(() => validateFrontierManifestSemantics(manifest)).toThrow(
      /verified claims require evidence/i,
    );
  });

  it("accepts verified claims with evidence", () => {
    const manifest: FrontierManifest = {
      schema_version: "ghostark.research.frontier_manifest.v1",
      artifact_id: "ghost-ark-frontier-dev",
      git_commit: fortyCharGitSha,
      claims: [
        {
          id: "phase-d-verified",
          phase: "phase_d",
          statement: "Witness checkpoint schema validation is verified.",
          status: "verified",
        },
      ],
      non_claims: ["This does not prove external witness independence."],
      evidence: [
        {
          id: "frontier-test-report",
          type: "test_report",
          path: "packages/research-frontier/test/frontierClaims.test.ts",
          sha256: sixtyFourCharSha,
        },
      ],
    };

    expect(() => validateFrontierManifestSemantics(manifest)).not.toThrow();
  });

  it("rejects unsafe research overclaims", () => {
    const manifest: FrontierManifest = {
      schema_version: "ghostark.research.frontier_manifest.v1",
      artifact_id: "ghost-ark-frontier-dev",
      git_commit: fortyCharGitSha,
      claims: [
        {
          id: "bad-claim",
          phase: "phase_c",
          statement: "This proves AI safety for governed LLM systems.",
          status: "experimental",
        },
      ],
      non_claims: [],
      evidence: [],
    };

    expect(() => validateFrontierManifestSemantics(manifest)).toThrow(
      /forbidden overclaim/i,
    );
  });
});
