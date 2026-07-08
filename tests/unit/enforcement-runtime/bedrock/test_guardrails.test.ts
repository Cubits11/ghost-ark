import { describe, expect, it, vi } from "vitest";
import { AwsBedrockInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/awsBedrockInvoker";

function mockBedrockClient() {
  const calls: { input: Record<string, unknown> }[] = [];
  const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
    calls.push(command);
    return {
      body: Buffer.from(JSON.stringify({ content: [{ type: "text", text: "ok" }] }))
    };
  });
  return { client: { send } as never, calls };
}

describe("AwsBedrockInvoker Guardrails configuration", () => {
  it("includes guardrail fields when configured", async () => {
    const { client, calls } = mockBedrockClient();
    const invoker = new AwsBedrockInvoker({
      client,
      guardrailId: "guardrail-123",
      guardrailVersion: "1"
    });
    const output = await invoker.invoke({
      modelId: "anthropic.claude-test",
      prompt: "hello",
      requestId: "request-a"
    });
    const command = calls[0];

    expect(command.input.guardrailIdentifier).toBe("guardrail-123");
    expect(command.input.guardrailVersion).toBe("1");
    expect(output.metadata?.guardrailConfigured).toBe(true);
  });

  it("omits guardrail fields by default", async () => {
    const { client, calls } = mockBedrockClient();
    const invoker = new AwsBedrockInvoker({ client });
    const output = await invoker.invoke({
      modelId: "anthropic.claude-test",
      prompt: "hello",
      requestId: "request-a"
    });
    const command = calls[0];

    expect(command.input.guardrailIdentifier).toBeUndefined();
    expect(command.input.guardrailVersion).toBeUndefined();
    expect(output.metadata?.guardrailConfigured).toBe(false);
  });

  it("keeps the generic JSON adapter disabled unless explicitly opted in", async () => {
    const unsupportedModelId = "meta.llama3-8b-instruct-v1:0";
    const defaultClient = mockBedrockClient();
    const defaultInvoker = new AwsBedrockInvoker({ client: defaultClient.client });

    await expect(
      defaultInvoker.invoke({
        modelId: unsupportedModelId,
        prompt: "hello",
        requestId: "request-a"
      })
    ).rejects.toThrow(/Unsupported Bedrock model family/u);
    expect(defaultClient.calls).toHaveLength(0);

    const optedInClient = mockBedrockClient();
    const optedInInvoker = new AwsBedrockInvoker({
      client: optedInClient.client,
      allowGenericJsonAdapter: true
    });
    await optedInInvoker.invoke({
      modelId: unsupportedModelId,
      prompt: "hello",
      requestId: "request-a"
    });

    expect(optedInClient.calls).toHaveLength(1);
    expect(JSON.parse(Buffer.from(optedInClient.calls[0].input.body as Uint8Array).toString("utf8"))).toEqual({
      inputText: "hello",
      textGenerationConfig: { maxTokenCount: 512, temperature: 0 }
    });
  });
});
