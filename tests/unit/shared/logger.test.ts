import { describe, expect, it } from "vitest";
import { redactForLog } from "../../../packages/shared/src/logger";

describe("structured log redaction", () => {
  it("redacts sensitive prompt, completion, memory, auth, and body fields", () => {
    expect(
      redactForLog({
        requestId: "request-a",
        prompt: "raw user text",
        nested: {
          completion: "raw model output",
          memoryWrite: "private memory",
          authorization: "Bearer token"
        },
        body: { arbitrary: "payload" }
      })
    ).toEqual({
      requestId: "request-a",
      prompt: "[REDACTED]",
      nested: {
        completion: "[REDACTED]",
        memoryWrite: "[REDACTED]",
        authorization: "[REDACTED]"
      },
      body: "[REDACTED]"
    });
  });
});
