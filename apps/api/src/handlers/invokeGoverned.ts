import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";
import { AuthorizationError, ValidationError, errorResponse } from "../../../../packages/shared/src/errors";
import { createLogger } from "../../../../packages/shared/src/logger";
import { optionalEnv, requiredEnv } from "../../../../packages/shared/src/config";
import { authenticate } from "../lib/auth";
import { assertTenantAccess } from "../lib/tenancy";
import { jsonResponse, parseJsonBody } from "../lib/validation";
import { assertNoClientDeclaredIdentity } from "../../../../packages/enforcement-runtime/src/identity/context";
import { parseModelAllowlist } from "../../../../packages/enforcement-runtime/src/bedrock/modelAllowlist";
import { AwsBedrockInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/awsBedrockInvoker";
import { FakeModelInvoker } from "../../../../packages/enforcement-runtime/src/bedrock/fakeInvoker";
import { DynamoDbPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/dynamodbPolicyRepository";
import { InMemoryPolicyRepository } from "../../../../packages/enforcement-runtime/src/policy/inMemoryPolicyRepository";
import { DynamoDbVaultStore } from "../../../../packages/enforcement-runtime/src/vault/dynamodbStore";
import { InMemoryVaultStore } from "../../../../packages/enforcement-runtime/src/vault/store";
import { DynamoDbDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/repository";
import { InMemoryDecisionReceiptRepository } from "../../../../packages/enforcement-runtime/src/receipts/inMemoryReceiptRepository";
import {
  DEFAULT_DECISION_RECEIPT_HMAC_SECRET,
  DefaultDecisionReceiptEmitter
} from "../../../../packages/enforcement-runtime/src/receipts/emission";
import { LocalDevHmacReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/signer";
import { KmsDecisionReceiptSigner } from "../../../../packages/enforcement-runtime/src/receipts/kmsSigner";
import { governedInvoke } from "../../../../packages/enforcement-runtime/src/runtime/governedInvoke";
import { EmfGovernedInvokeMetrics } from "../../../../packages/enforcement-runtime/src/runtime/metrics";
import { DynamoDbExecutionNonceStore } from "../../../../packages/enforcement-runtime/src/runtime/nonceStore";

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
  consentState: z.enum(["granted", "denied", "missing", "not_required"]).optional(),
  executionNonce: z.string().min(8).max(256).optional(),
  idempotencyKey: z.string().min(8).max(256).optional()
});

type InvokeBody = z.infer<typeof invokeBodySchema>;

function parseInvokeBody(value: unknown): InvokeBody {
  const parsed = invokeBodySchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Invalid governed invoke request", { issues: parsed.error.issues });
  }
  return parsed.data;
}

const secretCache = new Map<string, string>();

function parseBooleanEnv(name: string, fallback: boolean, env: NodeJS.ProcessEnv): boolean {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return value.toLowerCase() === "true";
}

export interface HmacSecretResolverOptions {
  readSecret?: (secretId: string) => Promise<string>;
}

async function readSecretsManagerString(secretId: string): Promise<string> {
  const cached = secretCache.get(secretId);
  if (cached) {
    return cached;
  }
  const client = new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = response.SecretString ?? (response.SecretBinary ? Buffer.from(response.SecretBinary).toString("utf8") : "");
  if (!value || value.trim().length === 0) {
    throw new ValidationError("Configured decision receipt HMAC secret is empty", { secretId });
  }
  secretCache.set(secretId, value);
  return value;
}

export async function hmacSecretForMode(env: NodeJS.ProcessEnv, options: HmacSecretResolverOptions = {}): Promise<string> {
  const configured = env.GHOST_ARK_RECEIPT_HMAC_SECRET;
  const signerMode = optionalEnv("GHOST_ARK_RECEIPT_SIGNER", "kms", env);
  if (configured && configured.trim().length > 0) {
    if (signerMode !== "local" && configured === DEFAULT_DECISION_RECEIPT_HMAC_SECRET) {
      throw new ValidationError("AWS/KMS governed invoke mode cannot use the local default decision receipt HMAC secret", {
        name: "GHOST_ARK_RECEIPT_HMAC_SECRET"
      });
    }
    return configured;
  }
  if (signerMode === "local") {
    return DEFAULT_DECISION_RECEIPT_HMAC_SECRET;
  }
  const secretId =
    env.GHOST_ARK_RECEIPT_HMAC_SECRET_ARN ?? env.GHOST_ARK_RECEIPT_HMAC_SECRET_ID ?? env.GHOST_ARK_RECEIPT_HMAC_SECRET_NAME;
  if (secretId && secretId.trim().length > 0) {
    return options.readSecret ? options.readSecret(secretId) : readSecretsManagerString(secretId);
  }
  throw new ValidationError("Missing governed invoke decision receipt HMAC secret configuration", {
    name: "GHOST_ARK_RECEIPT_HMAC_SECRET_ARN"
  });
}

async function buildDependencies(env: NodeJS.ProcessEnv) {
  const modelMode = optionalEnv("GHOST_ARK_MODEL_MODE", "bedrock", env);
  const policyMode = optionalEnv("GHOST_ARK_POLICY_REPOSITORY", "dynamodb", env);
  const vaultMode = optionalEnv("GHOST_ARK_VAULT", "dynamodb", env);
  const signerMode = optionalEnv("GHOST_ARK_RECEIPT_SIGNER", "kms", env);
  const receiptRepositoryMode = optionalEnv("GHOST_ARK_DECISION_RECEIPT_REPOSITORY", "dynamodb", env);
  const allowDefaultPolicy = parseBooleanEnv("GHOST_ARK_ALLOW_DEFAULT_POLICY", policyMode === "in_memory", env);
  const modelAllowlist = parseModelAllowlist(env.GHOST_ARK_BEDROCK_MODEL_ALLOWLIST);
  const hmacSecret = await hmacSecretForMode(env);

  if (modelMode !== "fake" && modelAllowlist.length === 0) {
    throw new ValidationError("GHOST_ARK_BEDROCK_MODEL_ALLOWLIST must be configured in AWS Bedrock mode", {
      name: "GHOST_ARK_BEDROCK_MODEL_ALLOWLIST"
    });
  }

  const policyRepository =
    policyMode === "in_memory"
      ? new InMemoryPolicyRepository({ allowDefaultPolicy })
      : new DynamoDbPolicyRepository({ tableName: requiredEnv("GHOST_ARK_POLICY_TABLE", env), allowDefaultPolicy });
  const modelInvoker =
    modelMode === "fake"
      ? new FakeModelInvoker({ outputText: optionalEnv("GHOST_ARK_FAKE_MODEL_OUTPUT", "fake governed invoke output", env) })
      : new AwsBedrockInvoker({
          guardrailId: env.GHOST_ARK_BEDROCK_GUARDRAIL_ID,
          guardrailVersion: env.GHOST_ARK_BEDROCK_GUARDRAIL_VERSION,
          allowGenericJsonAdapter: parseBooleanEnv("GHOST_ARK_BEDROCK_ALLOW_GENERIC_JSON_ADAPTER", false, env)
        });
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
    identityDigestSecret: hmacSecret,
    modelAllowlist: modelAllowlist.length > 0 ? modelAllowlist : undefined,
    retrievalOptions: {
      rejectCallerSuppliedContexts: parseBooleanEnv("GHOST_ARK_REJECT_CALLER_RETRIEVAL_CONTEXTS", modelMode !== "fake", env),
      requireProviderWhenEnabled: parseBooleanEnv("GHOST_ARK_REQUIRE_RETRIEVAL_PROVIDER", modelMode !== "fake", env)
    },
    metrics: new EmfGovernedInvokeMetrics(),
    metricDimensions: { stage: optionalEnv("STAGE", "dev", env) },
    executionNonceStore: env.GHOST_ARK_EXECUTION_NONCE_TABLE
      ? new DynamoDbExecutionNonceStore({ tableName: env.GHOST_ARK_EXECUTION_NONCE_TABLE })
      : undefined
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

    const result = await governedInvoke(await buildDependencies(process.env), {
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
      consentState: body.consentState ?? "missing",
      executionNonce: body.executionNonce ?? body.idempotencyKey
    });

    return jsonResponse(result.status === "failed_closed" ? 403 : 200, result);
  } catch (error) {
    logger.error("governed invoke failed", { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error);
  }
}
