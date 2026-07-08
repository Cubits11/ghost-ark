import { ValidationError } from "../../shared/src/errors";

export const tenantSlugPattern = /^[a-z][a-z0-9-]{1,47}$/u;

export interface TenantNamespaceInput {
  stage: string;
  tenantSlug: string;
  rawBucket: string;
  curatedBucket: string;
  exportBucket: string;
  resultsBucket: string;
  region: string;
}

export interface TenantNamespace {
  stage: string;
  tenantSlug: string;
  region: string;
  s3: {
    rawPrefix: string;
    curatedPrefix: string;
    exportPrefix: string;
    athenaResultsPrefix: string;
  };
  glue: {
    databaseName: string;
    crawlerName: string;
  };
  athena: {
    workgroupName: string;
  };
  dynamodb: {
    partitionKey: string;
  };
  lakeFormation: {
    tenantTagKey: "tenant_slug";
    tenantTagValue: string;
  };
  opensearch: {
    indexAlias: string;
  };
}

export function normalizeTenantSlug(input: string): string {
  if (/(\.\.|[*/\\{}[\]"'`$]|%2e|%2f)/iu.test(input)) {
    throw new ValidationError("Invalid tenant slug", {
      input,
      reason: "tenant slug contains traversal, wildcard, or JSON-policy metacharacters"
    });
  }
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/-{2,}/gu, "-").replace(/^-|-$/gu, "");
  if (!tenantSlugPattern.test(normalized)) {
    throw new ValidationError("Invalid tenant slug", { input, normalized, pattern: tenantSlugPattern.source });
  }
  return normalized;
}

export function compileTenantNamespace(input: TenantNamespaceInput): TenantNamespace {
  const tenantSlug = normalizeTenantSlug(input.tenantSlug);
  const stage = input.stage.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,24}$/u.test(stage)) {
    throw new ValidationError("Invalid stage", { stage: input.stage });
  }

  return {
    stage,
    tenantSlug,
    region: input.region,
    s3: {
      rawPrefix: `s3://${input.rawBucket}/tenants/${tenantSlug}/raw/`,
      curatedPrefix: `s3://${input.curatedBucket}/tenants/${tenantSlug}/curated/`,
      exportPrefix: `s3://${input.exportBucket}/tenants/${tenantSlug}/evidence-packs/`,
      athenaResultsPrefix: `s3://${input.resultsBucket}/tenants/${tenantSlug}/athena/`
    },
    glue: {
      databaseName: `ghost_ark_${stage}_${tenantSlug.replace(/-/gu, "_")}`,
      crawlerName: `ghost-ark-${stage}-${tenantSlug}-crawler`
    },
    athena: {
      workgroupName: `ghost-ark-${stage}-${tenantSlug}`
    },
    dynamodb: {
      partitionKey: tenantSlug
    },
    lakeFormation: {
      tenantTagKey: "tenant_slug",
      tenantTagValue: tenantSlug
    },
    opensearch: {
      indexAlias: `ghost-ark-${stage}-${tenantSlug}`
    }
  };
}
