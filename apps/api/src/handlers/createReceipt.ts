import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { buildReceiptPayload, GovernanceContext, ReceiptSubject } from "../../../../packages/receipt-schema/src/receipt";
import { errorResponse } from "../../../../packages/shared/src/errors";
import { loadRuntimeConfig } from "../../../../packages/shared/src/config";
import { createLogger } from "../../../../packages/shared/src/logger";
import { buildLineageEvent } from "../../../../packages/lineage-model/src/events";
import { signReceiptPayload } from "../../../../services/signing/kms/signer";
import { ReceiptRepository } from "../../../../services/ledger/dynamodb/data/receiptRepository";
import { ClaimRepository } from "../../../../services/ledger/dynamodb/data/claimRepository";
import { LineageRepository } from "../../../../services/ledger/dynamodb/data/lineageRepository";
import { authenticate } from "../lib/auth";
import { jsonResponse, parseJsonBody } from "../lib/validation";
import { assertNoClientDeclaredIdentity } from "../../../../packages/enforcement-runtime/src/identity/context";

interface CreateReceiptBody {
  subject: ReceiptSubject;
  evidenceObjects: string[];
  lineageEventIds?: string[];
  claimIds?: string[];
  governanceContext: GovernanceContext;
  transform?: {
    runId?: string;
    jobName?: string;
    inputVersion?: string;
    outputVersion?: string;
    parameters?: Record<string, unknown>;
  };
}

const logger = createLogger({ handler: "createReceipt" });

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const config = loadRuntimeConfig();
    const principal = authenticate(event);
    const body = parseJsonBody<CreateReceiptBody>(event.body);
    assertNoClientDeclaredIdentity(body);
    const payload = buildReceiptPayload({
      tenantSlug: principal.tenantSlug,
      subject: body.subject,
      evidenceObjects: body.evidenceObjects,
      lineageEventIds: body.lineageEventIds,
      claimIds: body.claimIds,
      governanceContext: body.governanceContext,
      transform: body.transform ? { ...body.transform, parameters: body.transform.parameters ?? {} } : undefined
    });

    const signature = await signReceiptPayload(payload, { keyId: config.signingKeyId });
    const now = new Date().toISOString();
    const record = { payload, signature, status: "issued" as const, createdAt: now, updatedAt: now };
    const receipts = new ReceiptRepository({ tableName: config.receiptTableName });
    const claims = new ClaimRepository({ tableName: config.claimTableName });
    const lineage = new LineageRepository({ tableName: config.lineageTableName });

    await receipts.put(record);
    for (const claimId of payload.claimIds) {
      await claims.attachReceipt(payload.tenantSlug, claimId, payload.receiptId);
    }
    await lineage.put(
      buildLineageEvent({
        tenantSlug: payload.tenantSlug,
        eventType: "signed",
        inputs: payload.evidenceObjects,
        outputs: [payload.receiptId],
        actor: principal.subject,
        runId: payload.transform?.runId,
        metadata: { keyId: signature.keyId, digestSha256: signature.digestSha256 }
      })
    );

    logger.info("receipt issued", { tenantSlug: payload.tenantSlug, receiptId: payload.receiptId });
    return jsonResponse(201, record);
  } catch (error) {
    logger.error("failed to create receipt", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error);
  }
}
