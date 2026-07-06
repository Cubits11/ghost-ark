import { Stack } from "aws-cdk-lib";
import { CfnDataLakeSettings, CfnTag } from "aws-cdk-lib/aws-lakeformation";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface LakeFormationGovernanceProps {
  adminRole: IRole;
}

export class LakeFormationGovernance extends Construct {
  readonly tenantTag: CfnTag;
  readonly classificationTag: CfnTag;
  readonly evidenceRoleTag: CfnTag;

  constructor(scope: Construct, id: string, props: LakeFormationGovernanceProps) {
    super(scope, id);
    new CfnDataLakeSettings(this, "DataLakeSettings", {
      admins: [{ dataLakePrincipalIdentifier: props.adminRole.roleArn }]
    });
    this.tenantTag = new CfnTag(this, "TenantSlugTag", {
      catalogId: Stack.of(this).account,
      tagKey: "tenant_slug",
      tagValues: ["example-tenant"]
    });
    this.classificationTag = new CfnTag(this, "ClassificationTag", {
      catalogId: Stack.of(this).account,
      tagKey: "classification",
      tagValues: ["public", "internal", "confidential", "restricted"]
    });
    this.evidenceRoleTag = new CfnTag(this, "EvidenceRoleTag", {
      catalogId: Stack.of(this).account,
      tagKey: "evidence_role",
      tagValues: ["raw", "curated", "receipt", "export"]
    });
  }
}
