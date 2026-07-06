import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { loadRuntimeConfig } from "../../../../packages/shared/src/config";
import { errorResponse, ValidationError } from "../../../../packages/shared/src/errors";
import { ReceiptRepository } from "../../../../services/ledger/dynamodb/data/receiptRepository";
import { authenticate } from "../lib/auth";
import { assertTenantAccess } from "../lib/tenancy";
import { jsonResponse } from "../lib/validation";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const config = loadRuntimeConfig();
    const principal = authenticate(event);
    const tenantSlug = event.pathParameters?.tenantSlug ?? principal.tenantSlug;
    const receiptId = event.pathParameters?.receiptId;
    if (!receiptId) {
      throw new ValidationError("receiptId path parameter is required");
    }
    assertTenantAccess(principal, tenantSlug);
    const repository = new ReceiptRepository({ tableName: config.receiptTableName });
    return jsonResponse(200, await repository.get(tenantSlug, receiptId));
  } catch (error) {
    return errorResponse(error);
  }
}
