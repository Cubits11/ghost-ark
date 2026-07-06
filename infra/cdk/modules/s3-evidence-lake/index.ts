import { Aws } from "aws-cdk-lib";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface S3EvidenceLakeProps {
  stage: string;
  project?: string;
  accountId?: string;
  region?: string;
}

export class S3EvidenceLake extends Construct {
  readonly rawBucket: IBucket;
  readonly curatedBucket: IBucket;
  readonly exportBucket: IBucket;
  readonly athenaResultsBucket: IBucket;

  constructor(scope: Construct, id: string, props: S3EvidenceLakeProps) {
    super(scope, id);
    const project = props.project ?? "ghost-ark";
    const accountId = props.accountId ?? Aws.ACCOUNT_ID;
    const region = props.region ?? Aws.REGION;
    const bucketName = (zone: string) => `${project}-${props.stage}-${zone}-${accountId}-${region}`;

    this.rawBucket = Bucket.fromBucketName(this, "RawEvidenceBucket", bucketName("raw"));
    this.curatedBucket = Bucket.fromBucketName(this, "CuratedEvidenceBucket", bucketName("curated"));
    this.exportBucket = Bucket.fromBucketName(this, "EvidenceExportBucket", bucketName("exports"));
    this.athenaResultsBucket = Bucket.fromBucketName(this, "AthenaResultsBucket", bucketName("athena-results"));
  }
}
