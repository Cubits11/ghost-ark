import { RemovalPolicy } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface S3EvidenceLakeProps {
  stage: string;
}

export class S3EvidenceLake extends Construct {
  readonly rawBucket: Bucket;
  readonly curatedBucket: Bucket;
  readonly exportBucket: Bucket;
  readonly athenaResultsBucket: Bucket;

  constructor(scope: Construct, id: string, props: S3EvidenceLakeProps) {
    super(scope, id);
    const common = {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: props.stage === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: props.stage === "prod" ? false : true
    };
    this.rawBucket = new Bucket(this, "RawEvidenceBucket", common);
    this.curatedBucket = new Bucket(this, "CuratedEvidenceBucket", common);
    this.exportBucket = new Bucket(this, "EvidenceExportBucket", common);
    this.athenaResultsBucket = new Bucket(this, "AthenaResultsBucket", common);
  }
}
