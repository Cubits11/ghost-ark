import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";
import { AuthorizationError, ValidationError, errorResponse } from "../../../../packages/shared/src/errors";
import { createLogger } from "../../../../packages/shared/src/logger";
import { optionalEnv, requiredEnv } from "../../../../packages/shared/src/config";
import { authenticate } from "../lib/auth";
import { assertTenantAccess } from "../lib/tenancy";
import { jsonResponse, parseJsonBody } from "../lib/validation";
import { assertNoClientDeclaredIdentity } from "../../../../packages/enforcement-runtime/src/identity/context";
import { AwsBedrockInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/awsBedrockInvoker";
import { FakeModelInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/fakeInvoker";
import { DynamoDbPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/dynamodbPolicyRepository";
import { InMemoryPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { DynamoDbVaultStore } from "../../../../packages/enforcement-runtime/src/vault/dynamodbStore";
import { InMemoryVaultStore } from "../../../../packages/enforcement-runtime/src/vault/store";
import { DynamoDbDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/repository";
import { InMemoryDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import { DefaultDecisionReceiptEmitter } from "../../../../packages/enforcement-runtime/src/receipts/emission";
import { LocalDevHmacReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { KmsDecisionReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { governedInvoke } from "../../../../packages/enforcement-runtime/src/runtime/governedInvoke";

const logger = createLogger({ handler: "invokeGoverned" });

const retrievedContextSchema = z.object({
  tenantId: z.string().min(1),
  digest: z.string().min(1),
  text: z.string().optional(),
  taint: z.array(z.enum(["trusted", "untrusted_instruction", "cross_tenant", "unknown_origin"])).default(["unknown_origin"]),
  source: z.string().optional()
});

const invokeBodySchema = z.object({
  model: z.object({
    modelId: z.string().min(1),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().positive().optional()
  }),
  input: z.object({
    text: z.string().min(1),
    contentDigest: z.string().optional()
  }),
  retrieval: z
    .object({
      enabled: z.boolean().default(false),
      contexts: z.array(retrievedContextSchema).default([])
    })
    .optional(),
  memoryWrite: z
    .object({
      tier: z.enum(["KAPPA", "SESSION", "CONSTITUTION", "AUDIT", "RESTRICTED"]),
      contentDigest: z.string().min(1),
      classificationTags: z.array(z.string().min(1)).default([]),
      expiresAt: z.string().datetime().optional()
    })
    .optional(),
  consentState: z.enum(["granted", "denied", "missing", "not_required"]).optional()
});

type InvokeBody = z.infer<typeof invokeBodySchema>;

function parseInvokeBody(value: unknown): InvokeBody {
  const parsed = invokeBodySchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid governed invoke request", { issues: parsed.error.issues });
  }
  return parsed.data;
}

function hmacSecretForMode(env: NodeJS.ProcessEnv): string {
  const configured = env.GHOST_ARK_RECEIPT_HMAC_SECRET;
  const signerMode = optionalEnv("GHOST_ARK_RECEIPT_SIGNER", "kms", env);
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  if (signerMode === "local") {
    return "ghost-ark-local-decision-receipt-secret";
  }
  throw new ValidationError("Missing required environment variable GHOST_ARK_RECEIPT_HMAC_SECRET", {
    name: "GHOST_ARK_RECEIPT_HMAC_SECRET"
  });
}

function buildDependencies(env: NodeJS.ProcessEnv) {
  const modelMode = optionalEnv("GHOST_ARK_MODEL_MODE", "bedrock", env);
  const policyMode = optionalEnv("GHOST_ARK_POLICY_REPOSITORY", "dynamodb", env);
  const vaultMode = optionalEnv("GHOST_ARK_VAULT", "dynamodb", env);
  const signerMode = optionalEnv("GHOST_ARK_RECEIPT_SIGNER", "kms", env);
  const receiptRepositoryMode = optionalEnv("GHOST_ARK_DECISION_RECEIPT_REPOSITORY", "dynamodb", env);
  const hmacSecret = hmacSecretForMode(env);

  const policyRepository =
    policyMode === "in_memory"
      ? new InMemoryPolicyRepository()
      : new DynamoDbPolicyRepository({ tableName: requiredEnv("GHOST_ARK_POLICY_TABLE", env) });
  const modelInvoker =
    modelMode === "fake"
      ? new FakeModelInvoker({ outputText: optionalEnv("GHOST_ARK_FAKE_MODEL_OUTPUT", "fake governed invoke output", env) })
      : new AwsBedrockInvoker();
  const vaultStore =
    vaultMode === "in_memory" ? new InMemoryVaultStore() : new DynamoDbVaultStore({ tableName: requiredEnv("GHOST_ARK_PRIVACY_VAULT_TABLE", env) });
  const receiptRepository =
    receiptRepositoryMode === "in_memory"
      ? new InMemoryDecisionReceiptRepository()
      : new DynamoDbDecisionReceiptRepository({ tableName: requiredEnv("GHOST_ARK_DECISION_RECEIPT_TABLE", env) });
  const signer =
    signerMode === "local"
      ? new LocalDevHmacReceiptSigner({ secret: optionalEnv("GHOST_ARK_LOCAL_RECEIPT_SIGNING_SECRET", "local-dev", env) })
      : new KmsDecisionReceiptSigner({ keyId: requiredEnv("GHOST_ARK_DECISION_SIGNING_KEY_ID", env) });

  return {
    policyRepository,
    modelInvoker,
    vaultStore,
    receiptEmitter: new DefaultDecisionReceiptEmitter({ signer, repository: receiptRepository, hmacSecret }),
    logger,
    identityDigestSecret: hmacSecret
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const principal = authenticate(event);
    if (principal.subject === "unknown-principal") {
      throw new AuthorizationError("Verified user identity is required for governed model invocation");
    }
    const tenantSlug = event.pathParameters?.tenantSlug ?? principal.tenantSlug;
    assertTenantAccess(principal, tenantSlug);
    const rawBody = parseJsonBody<unknown>(event.body);
    assertNoClientDeclaredIdentity(rawBody, { recursive: true });
    const body = parseInvokeBody(rawBody);

    const result = await governedInvoke(buildDependencies(process.env), {
      pathTenantId: tenantSlug,
      body: rawBody,
      auth: {
        tenantId: principal.tenantSlug,
        userId: principal.subject,
        role: principal.roles[0],
        requestId: event.requestContext.requestId,
        source: principal.source
      },
      model: body.model,
      input: body.input,
      retrieval: body.retrieval,
      memoryWrite: body.memoryWrite,
      consentState: body.consentState ?? "missing"
    });

    return jsonResponse(result.status === "failed_closed" ? 403 : 200, result);
  } catch (error) {
    logger.error("governed invoke failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error);
  }
}
