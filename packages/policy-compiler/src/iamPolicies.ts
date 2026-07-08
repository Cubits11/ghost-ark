import { canonicalSha256Hex } from "../../receipt-schema/src/hashCanonicalization";
import { TenantNamespaceInput, compileTenantNamespace } from "./tenantNamespace";

export interface TenantSandboxPolicyInput extends TenantNamespaceInput {
  accountId: string;
  allowedRegions: string[];
  tenantServiceRoleArn: string;
  permissionsBoundaryArn?: string;
}

export interface IamPolicyDocument {
  Version: "2012-10-17";
  Statement: Array<Record<string, unknown>>;
}

export interface CompiledIamPolicy {
  name: string;
  document: IamPolicyDocument;
  hash: string;
}

export function compileTenantSandboxPolicy(input: TenantSandboxPolicyInput): CompiledIamPolicy {
  const namespace = compileTenantNamespace(input);
  const principalSlug = "${aws:PrincipalTag/slug}";
  const allowedRegions = input.allowedRegions.length > 0 ? input.allowedRegions : [input.region];
  const resourcePrefix = `arn:aws`;

  const document: IamPolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "DenyOutsideApprovedRegions",
        Effect: "Deny",
        Action: "*",
        Resource: "*",
        Condition: {
          StringNotEquals: {
            "aws:RequestedRegion": allowedRegions
          }
        }
      },
      {
        Sid: "DenyIdentityAndBoundaryEscalation",
        Effect: "Deny",
        Action: [
          "iam:CreateUser",
          "iam:CreateAccessKey",
          "iam:AttachUserPolicy",
          "iam:AttachGroupPolicy",
          "iam:AttachRolePolicy",
          "iam:PutUserPolicy",
          "iam:PutGroupPolicy",
          "iam:PutRolePolicy",
          "iam:CreatePolicyVersion",
          "iam:SetDefaultPolicyVersion",
          "iam:DeletePermissionsBoundary",
          "organizations:*",
          "account:*"
        ],
        Resource: "*"
      },
      {
        Sid: "RequireTenantPrincipalTag",
        Effect: "Deny",
        Action: "*",
        Resource: "*",
        Condition: {
          Null: {
            "aws:PrincipalTag/slug": "true"
          }
        }
      },
      {
        Sid: "AllowTenantScopedS3EvidenceAccess",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListBucketMultipartUploads"],
        Resource: [
          `arn:aws:s3:::${input.rawBucket}/tenants/${principalSlug}/*`,
          `arn:aws:s3:::${input.curatedBucket}/tenants/${principalSlug}/*`,
          `arn:aws:s3:::${input.exportBucket}/tenants/${principalSlug}/*`,
          `arn:aws:s3:::${input.resultsBucket}/tenants/${principalSlug}/*`
        ]
      },
      {
        Sid: "AllowTenantScopedBucketListing",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: [
          `arn:aws:s3:::${input.rawBucket}`,
          `arn:aws:s3:::${input.curatedBucket}`,
          `arn:aws:s3:::${input.exportBucket}`,
          `arn:aws:s3:::${input.resultsBucket}`
        ],
        Condition: {
          StringLike: {
            "s3:prefix": [`tenants/${principalSlug}/*`, `tenants/${principalSlug}`]
          }
        }
      },
      {
        Sid: "AllowTenantReceiptLedgerAccess",
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
        Resource: [
          `${resourcePrefix}:dynamodb:${input.region}:${input.accountId}:table/ghost-ark-${input.stage}-receipts`
        ],
        Condition: {
          "ForAllValues:StringEquals": {
            "dynamodb:LeadingKeys": [principalSlug]
          }
        }
      },
      {
        Sid: "AllowTenantClaimLedgerAccess",
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        Resource: [
          `${resourcePrefix}:dynamodb:${input.region}:${input.accountId}:table/ghost-ark-${input.stage}-claims`,
        ],
        Condition: {
          "ForAllValues:StringEquals": {
            "dynamodb:LeadingKeys": [principalSlug]
          }
        }
      },
      {
        Sid: "AllowTenantLineageLedgerAccess",
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem"],
        Resource: [
          `${resourcePrefix}:dynamodb:${input.region}:${input.accountId}:table/ghost-ark-${input.stage}-lineage`
        ],
        Condition: {
          "ForAllValues:StringEquals": {
            "dynamodb:LeadingKeys": [principalSlug]
          }
        }
      },
      {
        Sid: "AllowGlueAthenaTenantWorkflows",
        Effect: "Allow",
        Action: [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "glue:GetDatabase",
          "glue:GetTable",
          "glue:GetPartitions",
          "glue:CreatePartition",
          "glue:BatchCreatePartition",
          "lakeformation:GetDataAccess"
        ],
        Resource: "*",
        Condition: {
          StringEquals: {
            "aws:PrincipalTag/slug": principalSlug
          }
        }
      },
      {
        Sid: "AllowServiceBoundPassRole",
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: input.tenantServiceRoleArn,
        Condition: {
          StringEquals: {
            "iam:PassedToService": ["glue.amazonaws.com", "lambda.amazonaws.com", "states.amazonaws.com"]
          }
        }
      },
      {
        Sid: "AllowTenantLambdaAndLogs",
        Effect: "Allow",
        Action: ["lambda:InvokeFunction", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"],
        Resource: [
          `${resourcePrefix}:lambda:${input.region}:${input.accountId}:function:ghost-ark-${input.stage}-${principalSlug}-*`,
          `${resourcePrefix}:logs:${input.region}:${input.accountId}:log-group:/aws/lambda/ghost-ark-${input.stage}-${principalSlug}-*:*`
        ]
      }
    ]
  };

  if (input.permissionsBoundaryArn) {
    document.Statement.push({
      Sid: "DenyRoleCreationWithoutBoundary",
      Effect: "Deny",
      Action: ["iam:CreateRole", "iam:PutRolePermissionsBoundary"],
      Resource: "*",
      Condition: {
        StringNotEquals: {
          "iam:PermissionsBoundary": input.permissionsBoundaryArn
        }
      }
    });
  }

  return {
    name: `ghost-ark-${namespace.stage}-${namespace.tenantSlug}-sandbox`,
    document,
    hash: canonicalSha256Hex(document)
  };
}
