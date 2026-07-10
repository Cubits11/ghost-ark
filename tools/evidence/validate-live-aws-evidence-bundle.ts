#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {
  formatEvidenceBundleValidationIssues,
  validateLiveAwsEvidenceBundle
} from "./liveAwsEvidenceBundle";

function usage(): string {
  return [
    "Usage: npm run validate:evidence-bundle -- [bundle.json ...]",
    "With no paths, the command validates examples/evidence/live-aws-evidence-bundle.sample.json."
  ].join("\n");
}

export function validateEvidenceBundleFiles(filePaths: string[]): boolean {
  let allValid = true;
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(resolved, "utf8"));
      const result = validateLiveAwsEvidenceBundle(parsed);
      if (!result.valid) {
        allValid = false;
        console.error(`${resolved}: INVALID\n${formatEvidenceBundleValidationIssues(result.issues)}`);
        continue;
      }
      const summary = parsed as Record<string, unknown>;
      console.log(
        JSON.stringify(
          {
            file: resolved,
            validation: "PASS",
            evidenceClassification: summary.evidenceClassification,
            lifecycleStatus: summary.lifecycleStatus,
            warning:
              summary.evidenceClassification === "synthetic-non-live"
                ? "Schema-valid synthetic fixture only; no live AWS evidence."
                : "Schema conformance does not independently establish that recorded AWS events occurred."
          },
          null,
          2
        )
      );
    } catch (error) {
      allValid = false;
      console.error(`${resolved}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return allValid;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
  } else if (
    !validateEvidenceBundleFiles(
      args.length > 0 ? args : ["examples/evidence/live-aws-evidence-bundle.sample.json"]
    )
  ) {
    process.exitCode = 1;
  }
}
