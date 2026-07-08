import { HttpRequest } from "@smithy/protocol-http";
import { describe, expect, it } from "vitest";
import { signedOpenSearchFetch } from "../../../apps/api/src/handlers/searchEvidence";

describe("searchEvidence OpenSearch SigV4 boundary", () => {
  it("sends OpenSearch requests through a SigV4 signer", async () => {
    const signedRequests: HttpRequest[] = [];
    let observedUrl = "";
    let observedHeaders: HeadersInit | undefined;

    const response = await signedOpenSearchFetch({
      endpoint: "https://search.example.com/",
      index: "ghost-ark-dev-acme-lab",
      region: "us-east-1",
      body: { query: { match_all: {} } },
      signer: {
        async sign(request) {
          request.headers.authorization = "AWS4-HMAC-SHA256 Credential=test";
          request.headers["x-amz-date"] = "20260708T000000Z";
          signedRequests.push(request);
          return request;
        }
      },
      fetchImpl: async (url, init) => {
        observedUrl = String(url);
        observedHeaders = init?.headers;
        return new Response(JSON.stringify({ hits: { total: { value: 0 } } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    expect(response.ok).toBe(true);
    expect(signedRequests).toHaveLength(1);
    expect(signedRequests[0].headers.host).toBe("search.example.com");
    expect(observedUrl).toBe("https://search.example.com/ghost-ark-dev-acme-lab/_search");
    expect(JSON.stringify(observedHeaders)).toContain("AWS4-HMAC-SHA256");
  });
});
