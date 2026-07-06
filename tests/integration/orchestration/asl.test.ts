import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Step Functions definitions", () => {
  it("receipt pipeline is valid JSON and contains AWS SDK integrations", () => {
    const definition = JSON.parse(fs.readFileSync(path.join(process.cwd(), "services/orchestration/stepfunctions/receipt_pipeline.asl.json"), "utf8"));
    expect(definition.StartAt).toBe("StartMetadataCrawler");
    expect(JSON.stringify(definition)).toContain("arn:aws:states:::aws-sdk:athena:startQueryExecution");
    expect(definition.States.PublishSuccess.End).toBe(true);
  });

  it("replay pipeline maps receipt IDs", () => {
    const definition = JSON.parse(fs.readFileSync(path.join(process.cwd(), "services/orchestration/stepfunctions/replay_pipeline.asl.json"), "utf8"));
    expect(definition.States.ReplayReceipts.Type).toBe("Map");
    expect(definition.States.ReplayReceipts.ItemsPath).toBe("$.receiptIds");
  });
});
