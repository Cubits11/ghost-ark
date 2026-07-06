import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { optionalEnv, requiredEnv } from "../../../../packages/shared/src/config";
import { errorResponse } from "../../../../packages/shared/src/errors";
import { authenticate } from "../lib/auth";
import { tenantFilter } from "../lib/tenancy";
import { jsonResponse } from "../lib/validation";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const principal = authenticate(event);
    const endpoint = requiredEnv("OPENSEARCH_ENDPOINT");
    const indexAliasPrefix = optionalEnv("OPENSEARCH_INDEX_PREFIX", "ghost-ark");
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

    const response = await fetch(`${endpoint.replace(/\/$/u, "")}/${indexAliasPrefix}-${principal.tenantSlug}/_search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    return jsonResponse(response.ok ? 200 : response.status, result);
  } catch (error) {
    return errorResponse(error);
  }
}
