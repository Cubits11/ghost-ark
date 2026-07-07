import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ClaimState } from "../../../../packages/receipt-schema/src/claimEnvelope";
import { loadRuntimeConfig } from "../../../../packages/shared/src/config";
import { errorResponse } from "../../../../packages/shared/src/errors";
import { ClaimRepository } from "../../../../services/ledger/dynamodb/data/claimRepository";
import { authenticate } from "../lib/auth";
import { assertTenantAccess } from "../lib/tenancy";
import { jsonResponse } from "../lib/validation";

const states = new Set(["draft", "under-review", "accepted", "disputed", "revoked", "superseded"]);

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const config = loadRuntimeConfig();
    const principal = authenticate(event);
    const tenantSlug = event.pathParameters?.tenantSlug ?? principal.tenantSlug;
    assertTenantAccess(principal, tenantSlug);
    const requestedState = event.queryStringParameters?.state;
    const state = requestedState && states.has(requestedState) ? (requestedState as ClaimState) : undefined;
    const limit = Number.parseInt(event.queryStringParameters?.limit ?? "100", 10);
    const repository = new ClaimRepository({ tableName: config.claimTableName });
    return jsonResponse(200, { claims: await repository.list(tenantSlug, state, Number.isFinite(limit) ? limit : 100) });
  } catch (error) {
    return errorResponse(error);
  }
}
