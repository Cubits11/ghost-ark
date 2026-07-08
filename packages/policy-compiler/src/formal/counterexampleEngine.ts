import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import type { IamPolicyDocument } from "../iamPolicies";
import type { TenantNamespace } from "../tenantNamespace";

export interface ModeledRequestState {
  readonly action: string;
  readonly resource: string;
  readonly principalTags: {
    readonly slug: string;
  };
  readonly conditionContext?: Record<string, string | readonly string[] | boolean | null>;
}

export interface TenantBoundaryModel {
  readonly tenantSlug: string;
  readonly allowedS3Prefixes: readonly string[];
  readonly allowedDynamoLeadingKeys: readonly string[];
  readonly allowedReceiptLedgerActions: readonly string[];
  readonly forbiddenReceiptLedgerActions: readonly string[];
  readonly allowedReadOnlyAthenaGlueLakeFormation?: boolean;
  readonly allowedS3ObjectActions?: readonly string[];
}

export interface PolicyCounterexample {
  readonly schemaVersion: "ghost.policy_counterexample.v1";
  readonly verifier: "ghost.policy_counterexample_engine.v1";
  readonly found: true;
  readonly requestState: ModeledRequestState;
  readonly violatedBoundary: string;
  readonly explanation: string;
}

export interface PolicyVerificationReport {
  readonly schemaVersion: "ghost.policy_verification_report.v1";
  readonly verdict: "PASS" | "FAIL";
  readonly scope: "ghost-ark-tenant-sandbox-subset";
  readonly policyDigest: string;
  readonly boundaryDigest: string;
  readonly counterexamples: readonly PolicyCounterexample[];
  readonly warnings: readonly string[];
  readonly nonClaims: readonly string[];
}

type ModeledPolicyDecision = "Allow" | "Deny" | "ImplicitDeny";

const verifier = "ghost.policy_counterexample_engine.v1" as const;
const reportScope = "ghost-ark-tenant-sandbox-subset" as const;

export const policyCounterexampleNonClaims = [
  "not full AWS IAM verification",
  "does not model all AWS Organizations SCP behavior",
  "does not model all resource policies",
  "does not model all service-specific condition keys",
  "bounded to Ghost-Ark generated tenant sandbox subset"
] as const;

const ddbActions = [
  "dynamodb:GetItem",
  "dynamodb:Query",
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
  "dynamodb:BatchWriteItem",
  "dynamodb:TransactWriteItems",
  "dynamodb:PartiQLUpdate",
  "dynamodb:PartiQLDelete"
] as const;

const s3Actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"] as const;
const tenantWorkflowActions = [
  "athena:StartQueryExecution",
  "athena:GetQueryExecution",
  "athena:GetQueryResults",
  "glue:GetDatabase",
  "glue:GetTable",
  "glue:GetPartitions",
  "glue:CreatePartition",
  "glue:BatchCreatePartition",
  "lakeformation:GetDataAccess"
] as const;
const destructiveWorkflowActions = ["athena:DeleteWorkGroup", "glue:DeleteTable", "lakeformation:RevokePermissions"] as const;

const allowedConditionOperators = new Set([
  "StringEquals",
  "ForAllValues:StringEquals",
  "StringLike",
  "StringNotEquals",
  "Null"
]);
const supportedStatementFields = new Set(["Sid", "Effect", "Action", "Resource", "Condition", "NotAction", "NotResource"]);
const supportedConditionKeys = new Set([
  "aws:PrincipalTag/slug",
  "aws:RequestedRegion",
  "dynamodb:LeadingKeys",
  "s3:prefix",
  "iam:PassedToService",
  "iam:PermissionsBoundary"
]);

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }
  return typeof value === "string" ? [value] : [];
}

function asConditionValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" || typeof item === "boolean" ? [String(item)] : []));
  }
  return typeof value === "string" || typeof value === "boolean" ? [String(value)] : [];
}

function statementSid(statement: Record<string, unknown>): string {
  return typeof statement.Sid === "string" ? statement.Sid : "(no Sid)";
}

function normalizeAction(action: string): string {
  return action.toLowerCase();
}

function hasWildcard(pattern: string): boolean {
  return /[*?]/u.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*").replace(/\?/gu, ".");
  return new RegExp(`^${escaped}$`, "u");
}

function matchesPattern(pattern: string, value: string): boolean {
  return pattern === value || (hasWildcard(pattern) && globToRegExp(pattern).test(value));
}

function substitutePrincipalTag(value: string, request: ModeledRequestState): string {
  return value.replace(/\$\{aws:PrincipalTag\/slug\}/gu, request.principalTags.slug);
}

function actionMatches(pattern: string, action: string): boolean {
  return matchesPattern(normalizeAction(pattern), normalizeAction(action));
}

function resourceMatches(pattern: string, resource: string, request: ModeledRequestState): boolean {
  return matchesPattern(substitutePrincipalTag(pattern, request), resource);
}

function requestContextValue(request: ModeledRequestState, key: string): string | readonly string[] | boolean | null | undefined {
  if (key === "aws:PrincipalTag/slug") {
    return request.principalTags.slug;
  }
  return request.conditionContext?.[key];
}

function valuesMatchPolicyValue(
  requestValue: string | readonly string[] | boolean | null | undefined,
  policyValues: readonly string[],
  request: ModeledRequestState,
  operator: "equals" | "like"
): boolean {
  if (requestValue === undefined || requestValue === null) {
    return false;
  }
  const observedValues = Array.isArray(requestValue) ? requestValue.map(String) : [String(requestValue)];
  const expectedValues = policyValues.map((value) => substitutePrincipalTag(value, request));
  if (operator === "equals") {
    return observedValues.some((observed) => expectedValues.includes(observed));
  }
  return observedValues.some((observed) => expectedValues.some((expected) => matchesPattern(expected, observed)));
}

function allValuesEqual(
  requestValue: string | readonly string[] | boolean | null | undefined,
  policyValues: readonly string[],
  request: ModeledRequestState
): boolean {
  if (requestValue === undefined || requestValue === null) {
    return false;
  }
  const observedValues = Array.isArray(requestValue) ? requestValue.map(String) : [String(requestValue)];
  const expectedValues = policyValues.map((value) => substitutePrincipalTag(value, request));
  return observedValues.length > 0 && observedValues.every((observed) => expectedValues.includes(observed));
}

function conditionMatches(condition: unknown, request: ModeledRequestState): boolean {
  if (condition === undefined) {
    return true;
  }
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    throw new Error("Unsupported condition shape");
  }

  for (const [operator, block] of Object.entries(condition as Record<string, unknown>)) {
    if (!allowedConditionOperators.has(operator)) {
      throw new Error(`Unsupported condition operator ${operator}`);
    }
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error(`Unsupported condition block for ${operator}`);
    }

    for (const [key, policyValue] of Object.entries(block as Record<string, unknown>)) {
      const values = asConditionValues(policyValue);
      const requestValue = requestContextValue(request, key);
      if (operator === "StringEquals" && !valuesMatchPolicyValue(requestValue, values, request, "equals")) {
        return false;
      }
      if (operator === "ForAllValues:StringEquals" && !allValuesEqual(requestValue, values, request)) {
        return false;
      }
      if (operator === "StringLike" && !valuesMatchPolicyValue(requestValue, values, request, "like")) {
        return false;
      }
      if (operator === "StringNotEquals" && valuesMatchPolicyValue(requestValue, values, request, "equals")) {
        return false;
      }
      if (operator === "Null") {
        const expectedNull = values.includes("true");
        const observedNull = requestValue === undefined || requestValue === null;
        if (observedNull !== expectedNull) {
          return false;
        }
      }
    }
  }

  return true;
}

function statementMatches(statement: Record<string, unknown>, request: ModeledRequestState): boolean {
  if ("NotAction" in statement || "NotResource" in statement) {
    throw new Error("NotAction and NotResource are outside the Ghost-Ark tenant sandbox model");
  }
  const actions = asArray(statement.Action);
  const resources = asArray(statement.Resource);
  if (actions.length === 0 || resources.length === 0) {
    return false;
  }
  if (!actions.some((action) => actionMatches(action, request.action))) {
    return false;
  }
  if (!resources.some((resource) => resourceMatches(resource, request.resource, request))) {
    return false;
  }
  return conditionMatches(statement.Condition, request);
}

function s3UriToArnPrefix(uri: string): string {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/u);
  if (!match) {
    throw new Error(`Unsupported S3 namespace URI ${uri}`);
  }
  return `arn:aws:s3:::${match[1]}/${match[2]}`;
}

function s3UriToBucketArn(uri: string): string {
  const match = uri.match(/^s3:\/\/([^/]+)\//u);
  if (!match) {
    throw new Error(`Unsupported S3 namespace URI ${uri}`);
  }
  return `arn:aws:s3:::${match[1]}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function receiptTableArn(namespace: TenantNamespace, accountId = "123456789012"): string {
  return `arn:aws:dynamodb:${namespace.region}:${accountId}:table/ghost-ark-${namespace.stage}-receipts`;
}

function claimTableArn(namespace: TenantNamespace, accountId = "123456789012"): string {
  return `arn:aws:dynamodb:${namespace.region}:${accountId}:table/ghost-ark-${namespace.stage}-claims`;
}

function lineageTableArn(namespace: TenantNamespace, accountId = "123456789012"): string {
  return `arn:aws:dynamodb:${namespace.region}:${accountId}:table/ghost-ark-${namespace.stage}-lineage`;
}

export function buildTenantBoundaryModel(input: {
  tenantSlug: string;
  namespace: TenantNamespace;
}): TenantBoundaryModel {
  const tenantRootPrefixes = [
    s3UriToArnPrefix(input.namespace.s3.rawPrefix).replace(/\/tenants\/[^/]+\/.*$/u, `/tenants/${input.tenantSlug}/`),
    s3UriToArnPrefix(input.namespace.s3.curatedPrefix).replace(/\/tenants\/[^/]+\/.*$/u, `/tenants/${input.tenantSlug}/`),
    s3UriToArnPrefix(input.namespace.s3.exportPrefix).replace(/\/tenants\/[^/]+\/.*$/u, `/tenants/${input.tenantSlug}/`),
    s3UriToArnPrefix(input.namespace.s3.athenaResultsPrefix).replace(/\/tenants\/[^/]+\/.*$/u, `/tenants/${input.tenantSlug}/`)
  ];
  return {
    tenantSlug: input.tenantSlug,
    allowedS3Prefixes: unique([
      ...tenantRootPrefixes,
      s3UriToArnPrefix(input.namespace.s3.rawPrefix),
      s3UriToArnPrefix(input.namespace.s3.curatedPrefix),
      s3UriToArnPrefix(input.namespace.s3.exportPrefix),
      s3UriToArnPrefix(input.namespace.s3.athenaResultsPrefix)
    ]),
    allowedDynamoLeadingKeys: [input.namespace.dynamodb.partitionKey],
    allowedReceiptLedgerActions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
    forbiddenReceiptLedgerActions: [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:PartiQLDelete",
      "dynamodb:PartiQLUpdate",
      "dynamodb:TransactWriteItems",
      "dynamodb:UpdateItem",
      "dynamodb:*",
      "*"
    ],
    allowedReadOnlyAthenaGlueLakeFormation: true,
    allowedS3ObjectActions: [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:AbortMultipartUpload",
      "s3:ListBucketMultipartUploads"
    ]
  };
}

function contextForAction(action: string, tenantSlug: string, region: string, leadingKey: string): ModeledRequestState["conditionContext"] {
  const context: Record<string, string | readonly string[] | boolean | null> = {
    "aws:RequestedRegion": region
  };
  if (action.startsWith("dynamodb:")) {
    context["dynamodb:LeadingKeys"] = [leadingKey];
  }
  if (action === "s3:ListBucket") {
    context["s3:prefix"] = `tenants/${leadingKey}/*`;
  }
  if (action === "iam:PassRole") {
    context["iam:PassedToService"] = "glue.amazonaws.com";
  }
  context["aws:PrincipalTag/slug"] = tenantSlug;
  return context;
}

export function enumerateModeledRequestStates(input: {
  tenantSlug: string;
  namespace: TenantNamespace;
}): ModeledRequestState[] {
  const crossTenantSlug = input.tenantSlug === "tenant-b" ? "tenant-c" : "tenant-b";
  const prefixes = [
    s3UriToArnPrefix(input.namespace.s3.rawPrefix),
    s3UriToArnPrefix(input.namespace.s3.curatedPrefix),
    s3UriToArnPrefix(input.namespace.s3.exportPrefix),
    s3UriToArnPrefix(input.namespace.s3.athenaResultsPrefix)
  ];
  const bucketRoots = [
    s3UriToBucketArn(input.namespace.s3.rawPrefix),
    s3UriToBucketArn(input.namespace.s3.curatedPrefix),
    s3UriToBucketArn(input.namespace.s3.exportPrefix),
    s3UriToBucketArn(input.namespace.s3.athenaResultsPrefix)
  ];
  const resources = [
    ...prefixes.map((prefix) => `${prefix}object.json`),
    ...prefixes.map((prefix) => prefix.replace(`/tenants/${input.tenantSlug}/`, `/tenants/${crossTenantSlug}/`) + "object.json"),
    ...bucketRoots,
    receiptTableArn(input.namespace),
    claimTableArn(input.namespace),
    lineageTableArn(input.namespace),
    `arn:aws:dynamodb:${input.namespace.region}:123456789012:table/ghost-ark-${input.namespace.stage}-unscoped`,
    "*",
    `arn:aws:iam::123456789012:role/ghost-ark-${input.namespace.stage}-${input.tenantSlug}-tenant-service-role`,
    `arn:aws:lambda:${input.namespace.region}:123456789012:function:ghost-ark-${input.namespace.stage}-${input.tenantSlug}-worker`,
    `arn:aws:logs:${input.namespace.region}:123456789012:log-group:/aws/lambda/ghost-ark-${input.namespace.stage}-${input.tenantSlug}-worker:*`
  ];
  const actions = [
    ...ddbActions,
    "dynamodb:*",
    ...s3Actions,
    "s3:*",
    ...tenantWorkflowActions,
    ...destructiveWorkflowActions,
    "iam:PassRole",
    "iam:CreateUser",
    "lambda:InvokeFunction",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "logs:DescribeLogStreams",
    "*"
  ];

  const states: ModeledRequestState[] = [];
  for (const principalSlug of [input.tenantSlug, crossTenantSlug]) {
    for (const leadingKey of [input.tenantSlug, crossTenantSlug]) {
      for (const action of actions) {
        for (const resource of unique(resources)) {
          states.push({
            action,
            resource,
            principalTags: { slug: principalSlug },
            conditionContext: contextForAction(action, principalSlug, input.namespace.region, leadingKey)
          });
        }
      }
    }
  }
  return states;
}

function policyResourceProbes(document: IamPolicyDocument, tenantSlug: string): string[] {
  const crossTenantSlug = tenantSlug === "tenant-b" ? "tenant-c" : "tenant-b";
  const resources = document.Statement.flatMap((statement) => asArray(statement.Resource)).map((resource) =>
    resource.replace(/\$\{aws:PrincipalTag\/slug\}/gu, tenantSlug)
  );
  const exactResources = resources.filter((resource) => !hasWildcard(resource) || resource === "*");
  const crossTenantResources = resources
    .filter((resource) => resource.includes(`/tenants/${tenantSlug}/`))
    .map((resource) => resource.replace(`/tenants/${tenantSlug}/`, `/tenants/${crossTenantSlug}/`))
    .flatMap((resource) => (hasWildcard(resource) ? [resource.replace(/\*/gu, "object.json")] : [resource]));
  const wildcardExpanded = resources.flatMap((resource) => {
    if (!resource.includes("*")) {
      return [resource];
    }
    return [
      resource.replace(/\*/gu, "object.json"),
      resource.replace(/\*/gu, "cross-tenant/object.json").replace(`/tenants/${tenantSlug}/`, `/tenants/${crossTenantSlug}/`)
    ];
  });
  return unique([...exactResources, ...crossTenantResources, ...wildcardExpanded, "*"]);
}

function requestStateProbes(document: IamPolicyDocument, boundary: TenantBoundaryModel): ModeledRequestState[] {
  const crossTenantSlug = boundary.tenantSlug === "tenant-b" ? "tenant-c" : "tenant-b";
  const resources = policyResourceProbes(document, boundary.tenantSlug);
  const actions = unique([
    ...document.Statement.flatMap((statement) => asArray(statement.Action)),
    ...ddbActions,
    "dynamodb:*",
    ...s3Actions,
    "s3:*",
    ...tenantWorkflowActions,
    ...destructiveWorkflowActions,
    "iam:PassRole",
    "iam:CreateUser",
    "lambda:InvokeFunction",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "logs:DescribeLogStreams",
    "*"
  ]);
  const states: ModeledRequestState[] = [];
  for (const principalSlug of [boundary.tenantSlug]) {
    for (const leadingKey of [boundary.tenantSlug, crossTenantSlug, ""]) {
      for (const action of actions) {
        for (const resource of resources) {
          const context = contextForAction(action, principalSlug, "us-east-1", leadingKey || crossTenantSlug);
          if (leadingKey === "" && context) {
            delete context["dynamodb:LeadingKeys"];
            delete context["s3:prefix"];
          }
          states.push({ action, resource, principalTags: { slug: principalSlug }, conditionContext: context });
        }
      }
    }
  }
  return states;
}

export function evaluateModeledPolicy(input: {
  document: IamPolicyDocument;
  request: ModeledRequestState;
}): ModeledPolicyDecision {
  let allowed = false;
  for (const statement of input.document.Statement) {
    if (!statement || typeof statement !== "object" || Array.isArray(statement)) {
      throw new Error("Malformed IAM statement");
    }
    if (!statementMatches(statement, input.request)) {
      continue;
    }
    if (statement.Effect === "Deny") {
      return "Deny";
    }
    if (statement.Effect === "Allow") {
      allowed = true;
    }
  }
  return allowed ? "Allow" : "ImplicitDeny";
}

function isReceiptLedgerResource(resource: string): boolean {
  return /:table\/ghost-ark-[^/:]+-receipts(?:$|[/*])/u.test(resource);
}

function isTenantS3Object(resource: string, boundary: TenantBoundaryModel): boolean {
  return boundary.allowedS3Prefixes.some((prefix) => resource.startsWith(prefix));
}

function isS3BucketRoot(resource: string, boundary: TenantBoundaryModel): boolean {
  const bucketRoots = boundary.allowedS3Prefixes.map((prefix) => prefix.replace(/\/tenants\/.+$/u, ""));
  return bucketRoots.includes(resource);
}

function contextHasAllowedLeadingKey(request: ModeledRequestState, boundary: TenantBoundaryModel): boolean {
  const value = request.conditionContext?.["dynamodb:LeadingKeys"];
  const values = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
  return values.length > 0 && values.every((entry) => boundary.allowedDynamoLeadingKeys.includes(entry));
}

function contextHasAllowedS3Prefix(request: ModeledRequestState, boundary: TenantBoundaryModel): boolean {
  const value = request.conditionContext?.["s3:prefix"];
  const values = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
  return values.length > 0 && values.every((entry) => entry === `tenants/${boundary.tenantSlug}` || entry.startsWith(`tenants/${boundary.tenantSlug}/`));
}

function isForbiddenReceiptLedgerAction(action: string, boundary: TenantBoundaryModel): boolean {
  const normalized = normalizeAction(action);
  if (hasWildcard(normalized)) {
    return boundary.forbiddenReceiptLedgerActions.some((forbidden) => actionMatches(forbidden, normalized));
  }
  return boundary.forbiddenReceiptLedgerActions
    .filter((forbidden) => !hasWildcard(forbidden))
    .some((forbidden) => normalizeAction(forbidden) === normalized);
}

function isAllowedReceiptLedgerAction(action: string, boundary: TenantBoundaryModel): boolean {
  return boundary.allowedReceiptLedgerActions.some((allowed) => actionMatches(allowed, action));
}

function isDynamoAction(action: string): boolean {
  return normalizeAction(action).startsWith("dynamodb:");
}

function isS3Action(action: string): boolean {
  return normalizeAction(action).startsWith("s3:");
}

function isWorkflowAction(action: string): boolean {
  const normalized = normalizeAction(action);
  return /^(athena|glue|lakeformation):/u.test(normalized);
}

function isTenantLambdaOrLogs(action: string, resource: string, boundary: TenantBoundaryModel): boolean {
  const normalized = normalizeAction(action);
  return (
    (/^(lambda:invokefunction|logs:createlogstream|logs:putlogevents|logs:describelogstreams)$/u.test(normalized)) &&
    resource.includes(`ghost-ark-`) &&
    resource.includes(boundary.tenantSlug)
  );
}

export function evaluateTenantBoundary(input: {
  boundary: TenantBoundaryModel;
  request: ModeledRequestState;
}): "Allow" | "Deny" {
  const { boundary, request } = input;
  if (request.principalTags.slug !== boundary.tenantSlug) {
    return "Deny";
  }

  if (isS3Action(request.action)) {
    if (request.action === "s3:ListBucket") {
      return isS3BucketRoot(request.resource, boundary) && contextHasAllowedS3Prefix(request, boundary) ? "Allow" : "Deny";
    }
    return isTenantS3Object(request.resource, boundary) &&
      (boundary.allowedS3ObjectActions ?? ["s3:GetObject", "s3:PutObject"]).some((action) => actionMatches(action, request.action))
      ? "Allow"
      : "Deny";
  }

  if (isDynamoAction(request.action)) {
    if (!contextHasAllowedLeadingKey(request, boundary)) {
      return "Deny";
    }
    if (isReceiptLedgerResource(request.resource)) {
      return !isForbiddenReceiptLedgerAction(request.action, boundary) && isAllowedReceiptLedgerAction(request.action, boundary)
        ? "Allow"
        : "Deny";
    }
    return /:table\/ghost-ark-/u.test(request.resource) &&
      ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"].some((action) => actionMatches(action, request.action))
      ? "Allow"
      : "Deny";
  }

  if (isWorkflowAction(request.action)) {
    return boundary.allowedReadOnlyAthenaGlueLakeFormation &&
      [...tenantWorkflowActions].some((action) => actionMatches(action, request.action))
      ? "Allow"
      : "Deny";
  }

  if (request.action === "iam:PassRole") {
    return request.resource.includes(boundary.tenantSlug) && request.conditionContext?.["iam:PassedToService"] !== undefined
      ? "Allow"
      : "Deny";
  }

  if (isTenantLambdaOrLogs(request.action, request.resource, boundary)) {
    return "Allow";
  }

  return "Deny";
}

function policyDigest(document: IamPolicyDocument): string {
  return `sha256:${canonicalSha256Hex({
    schemaVersion: "ghost.policy_counterexample.policy_digest.v1",
    document
  })}`;
}

function boundaryDigest(boundary: TenantBoundaryModel): string {
  return `sha256:${canonicalSha256Hex({
    schemaVersion: "ghost.policy_counterexample.boundary_digest.v1",
    boundary
  })}`;
}

function unsupportedPolicyWarnings(document: IamPolicyDocument): string[] {
  const warnings: string[] = [];
  for (const statement of document.Statement) {
    const sid = statementSid(statement);
    for (const field of Object.keys(statement)) {
      if (!supportedStatementFields.has(field)) {
        warnings.push(`Unsupported statement field ${field} in statement ${sid}; failing closed.`);
      }
    }
    if (statement.Effect !== "Allow" && statement.Effect !== "Deny") {
      warnings.push(`Unsupported Effect in statement ${sid}; expected Allow or Deny, failing closed.`);
    }
    if ("NotAction" in statement) {
      warnings.push(`Unsupported NotAction in statement ${sid}; failing closed.`);
    }
    if ("NotResource" in statement) {
      warnings.push(`Unsupported NotResource in statement ${sid}; failing closed.`);
    }
    if (!("NotAction" in statement)) {
      const actionValues = asArray(statement.Action);
      const actionMalformed =
        actionValues.length === 0 ||
        (Array.isArray(statement.Action) && actionValues.length !== statement.Action.length) ||
        (statement.Action !== undefined && !Array.isArray(statement.Action) && typeof statement.Action !== "string");
      if (actionMalformed) {
        warnings.push(`Unsupported Action shape in statement ${sid}; failing closed.`);
      }
    }
    if (!("NotResource" in statement)) {
      const resourceValues = asArray(statement.Resource);
      const resourceMalformed =
        resourceValues.length === 0 ||
        (Array.isArray(statement.Resource) && resourceValues.length !== statement.Resource.length) ||
        (statement.Resource !== undefined && !Array.isArray(statement.Resource) && typeof statement.Resource !== "string");
      if (resourceMalformed) {
        warnings.push(`Unsupported Resource shape in statement ${sid}; failing closed.`);
      }
    }
    const condition = statement.Condition;
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      for (const [operator, block] of Object.entries(condition)) {
        if (!allowedConditionOperators.has(operator)) {
          warnings.push(`Unsupported condition operator ${operator} in statement ${sid}; failing closed.`);
          continue;
        }
        if (!block || typeof block !== "object" || Array.isArray(block)) {
          warnings.push(`Unsupported condition block for ${operator} in statement ${sid}; failing closed.`);
          continue;
        }
        for (const [key, policyValue] of Object.entries(block as Record<string, unknown>)) {
          if (!supportedConditionKeys.has(key)) {
            warnings.push(`Unsupported condition key ${key} in statement ${sid}; failing closed.`);
          }
          const conditionValues = asConditionValues(policyValue);
          const conditionValueMalformed =
            conditionValues.length === 0 ||
            (Array.isArray(policyValue) && conditionValues.length !== policyValue.length) ||
            (policyValue !== undefined &&
              !Array.isArray(policyValue) &&
              typeof policyValue !== "string" &&
              typeof policyValue !== "boolean");
          if (conditionValueMalformed) {
            warnings.push(`Unsupported condition value for ${key} in statement ${sid}; failing closed.`);
          }
          if (operator !== "Null" && conditionValues.some((value) => value.length === 0)) {
            warnings.push(`Unsupported empty condition value for ${key} in statement ${sid}; failing closed.`);
          }
          if (operator === "Null" && conditionValues.some((value) => value !== "true" && value !== "false")) {
            warnings.push(`Unsupported Null condition value for ${key} in statement ${sid}; failing closed.`);
          }
        }
      }
    } else if (condition !== undefined) {
      warnings.push(`Unsupported condition shape in statement ${sid}; failing closed.`);
    }
    const iamActions = asArray(statement.Action).filter((action) => action.toLowerCase().startsWith("iam:"));
    if (iamActions.length > 0) {
      warnings.push(`IAM actions in statement ${sid} are modeled only for bounded service-role pass-through: ${iamActions.join(", ")}.`);
    }
  }
  return warnings;
}

function failClosedWarnings(warnings: readonly string[]): boolean {
  return warnings.some((warning) => /Unsupported|Malformed|Invalid/u.test(warning));
}

function counterexampleFor(request: ModeledRequestState, boundaryDecision: "Allow" | "Deny"): PolicyCounterexample {
  return {
    schemaVersion: "ghost.policy_counterexample.v1",
    verifier,
    found: true,
    requestState: request,
    violatedBoundary: "generated policy allowed a request outside the declared tenant boundary",
    explanation: `Modeled policy returned Allow while the Ghost-Ark tenant boundary returned ${boundaryDecision}.`
  };
}

export function verifyNoTenantBoundaryCounterexample(input: {
  document: IamPolicyDocument;
  boundary: TenantBoundaryModel;
}): PolicyVerificationReport {
  const warnings = unsupportedPolicyWarnings(input.document);
  const counterexamples: PolicyCounterexample[] = [];

  if (!failClosedWarnings(warnings)) {
    for (const request of requestStateProbes(input.document, input.boundary)) {
      let policyDecision: ModeledPolicyDecision;
      try {
        policyDecision = evaluateModeledPolicy({ document: input.document, request });
      } catch (error) {
        warnings.push(error instanceof Error ? `${error.message}; failing closed.` : String(error));
        break;
      }
      const boundaryDecision = evaluateTenantBoundary({ boundary: input.boundary, request });
      if (policyDecision === "Allow" && boundaryDecision === "Deny") {
        counterexamples.push(counterexampleFor(request, boundaryDecision));
      }
    }
  }

  return {
    schemaVersion: "ghost.policy_verification_report.v1",
    verdict: counterexamples.length === 0 && !failClosedWarnings(warnings) ? "PASS" : "FAIL",
    scope: reportScope,
    policyDigest: policyDigest(input.document),
    boundaryDigest: boundaryDigest(input.boundary),
    counterexamples,
    warnings,
    nonClaims: [...policyCounterexampleNonClaims]
  };
}
