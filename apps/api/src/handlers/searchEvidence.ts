import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { formatUrl } from "@aws-sdk/util-format-url";
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { optionalEnv, requiredEnv } from "../../../../packages/shared/src/config";
import { errorResponse } from "../../../../packages/shared/src/errors";
import { authenticate } from "../lib/auth";
import { assertTenantAccess, tenantFilter } from "../lib/tenancy";
import { jsonResponse } from "../lib/validation";

export interface SignedOpenSearchFetchOptions {
  endpoint: string;
  index: string;
  region: string;
  body: unknown;
  fetchImpl?: typeof fetch;
  signer?: { sign(request: HttpRequest): Promise<HttpRequest> };
}

export async function signedOpenSearchFetch(options: SignedOpenSearchFetchOptions): Promise<Response> {
  const endpoint = options.endpoint.replace(/\/$/u, "");
  const url = new URL(`${endpoint}/${encodeURIComponent(options.index)}/_search`);
  const requestBody = JSON.stringify(options.body);
  const signer =
    options.signer ??
    new SignatureV4({
      credentials: defaultProvider(),
      service: "es",
      region: options.region,
      sha256: Hash.bind(null, "sha256")
    });
  const signed = await signer.sign(
    new HttpRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      method: "POST",
      path: url.pathname,
      headers: {
        "content-type": "application/json",
        host: url.host
      },
      body: requestBody
    })
  );

  return (options.fetchImpl ?? fetch)(formatUrl(signed), {
    method: signed.method,
    headers: signed.headers,
    body: signed.body as BodyInit
  });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const principal = authenticate(event);
    const tenantSlug = event.pathParameters?.tenantSlug ?? principal.tenantSlug;
    assertTenantAccess(principal, tenantSlug);
    const endpoint = requiredEnv("OPENSEARCH_ENDPOINT");
    const indexAliasPrefix = optionalEnv("OPENSEARCH_INDEX_PREFIX", "ghost-ark");
    const region = optionalEnv("AWS_REGION", "us-east-1");
    const query = event.queryStringParameters?.q ?? "*";
    const size = Math.min(Number.parseInt(event.queryStringParameters?.size ?? "25", 10) || 25, 100);
    const body = {
      size,
      query: {
        bool: {
          filter: [tenantFilter(principal)],
          must: query === "*" ? [{ match_all: {} }] : [{ simple_query_string: { query, fields: ["title^2", "body", "objectUri"] } }]
        }
      },
      sort: [{ observedAt: { order: "desc" } }]
    };

    const response = await signedOpenSearchFetch({
      endpoint,
      index: `${indexAliasPrefix}-${principal.tenantSlug}`,
      region,
      body
    });
    const result = await response.json();
    return jsonResponse(response.ok ? 200 : response.status, result);
  } catch (error) {
    return errorResponse(error);
  }
}
