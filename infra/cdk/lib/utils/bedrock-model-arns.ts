import { Aws } from "aws-cdk-lib";

export function foundationModelArn(modelId: string): string {
  return `arn:${Aws.PARTITION}:bedrock:${Aws.REGION}::foundation-model/${modelId}`;
}
