import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as http from "http";
import { AddressInfo } from "net";
import { createHash } from "crypto";
import { executeGovernedTransit } from "../../../../packages/enforcement-runtime/src/gateway/sidecarProxy";

describe("governed transit through the sidecar gateway (real sockets, no mocks)", () => {
  let server: http.Server;
  let port: number;
  let requestsServed = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestsServed += 1;
      const bodyChunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
      req.on("end", () => {
        if (req.url === "/big") {
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(Buffer.alloc(64 * 1024, 0x78));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        // Respond in multiple chunks so the digester exercises the stream path.
        res.write('{"status":"success","action":"database_write",');
        res.write('"echo":');
        res.end(`${JSON.stringify(Buffer.concat(bodyChunks).toString("utf8"))}}`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("digests the exact bytes that crossed the wire and labels them GATEWAY_RECORDED", async () => {
    const agentPayload = Buffer.from(JSON.stringify({ command: "DROP TABLE users;" }));

    const record = await executeGovernedTransit({
      targetUrl: `http://127.0.0.1:${port}/api/v1/execute`,
      toolName: "PostgresTool",
      requestBody: agentPayload,
      sequenceNum: 1,
      allowedDestinations: [`127.0.0.1:${port}`]
    });

    expect(record.statusCode).toBe(200);
    expect(record.toolName).toBe("PostgresTool");

    const expectedRequestDigest = `sha256:${createHash("sha256").update(agentPayload).digest("hex")}`;
    const expectedResponseDigest = `sha256:${createHash("sha256").update(record.body).digest("hex")}`;

    expect(record.requestDigest).toBe(expectedRequestDigest);
    expect(record.responseDigest).toBe(expectedResponseDigest);
    expect(record.responseEvidence.contentDigest).toBe(expectedResponseDigest);
    expect(record.responseEvidence.provenanceClass).toBe("GATEWAY_RECORDED");
    expect(JSON.parse(record.body.toString("utf8")).echo).toBe(agentPayload.toString("utf8"));
  });

  it("derives the evidence id from transit content, not from time or randomness", async () => {
    const payload = Buffer.from(JSON.stringify({ command: "SELECT 1" }));
    const run = () =>
      executeGovernedTransit({
        targetUrl: `http://127.0.0.1:${port}/api/v1/execute`,
        toolName: "PostgresTool",
        requestBody: payload,
        sequenceNum: 7,
        allowedDestinations: [`127.0.0.1:${port}`]
      });

    const [first, second] = [await run(), await run()];
    expect(first.responseEvidence.evidenceId).toMatch(/^evd_[a-f0-9]{64}$/u);
    expect(first.responseEvidence.evidenceId).toBe(second.responseEvidence.evidenceId);
  });

  it("fails closed on destinations outside the allowlist without opening a connection", async () => {
    const served = requestsServed;
    await expect(
      executeGovernedTransit({
        targetUrl: `http://127.0.0.1:${port}/api/v1/execute`,
        toolName: "PostgresTool",
        requestBody: Buffer.from("{}"),
        sequenceNum: 2,
        allowedDestinations: ["127.0.0.1:1"]
      })
    ).rejects.toThrowError(/allowlist/u);
    expect(requestsServed).toBe(served);
  });

  it("refuses non-http protocols", async () => {
    await expect(
      executeGovernedTransit({
        targetUrl: "ftp://127.0.0.1:21/pull",
        toolName: "FtpTool",
        requestBody: Buffer.from("{}"),
        sequenceNum: 3,
        allowedDestinations: ["127.0.0.1:21"]
      })
    ).rejects.toThrowError(/http and https/u);
  });

  it("fails closed when the physical tool connection severs", async () => {
    const probe = http.createServer(() => undefined);
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const deadPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));

    await expect(
      executeGovernedTransit({
        targetUrl: `http://127.0.0.1:${deadPort}/api`,
        toolName: "DeadTool",
        requestBody: Buffer.from("test"),
        sequenceNum: 4,
        allowedDestinations: [`127.0.0.1:${deadPort}`]
      })
    ).rejects.toThrowError(/Transit boundary severed/u);
  });

  it("fails closed when the response exceeds the transit byte cap", async () => {
    await expect(
      executeGovernedTransit({
        targetUrl: `http://127.0.0.1:${port}/big`,
        toolName: "BulkTool",
        requestBody: Buffer.from("{}"),
        sequenceNum: 5,
        allowedDestinations: [`127.0.0.1:${port}`],
        maxResponseBytes: 1024
      })
    ).rejects.toThrowError(/transit cap/u);
  });
});
