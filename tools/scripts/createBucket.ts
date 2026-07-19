import { loadGoogleCloudConfig } from "../../packages/google-cloud/src";

export async function createBucketScript() {
  const config = loadGoogleCloudConfig();
  console.log(`[Script] Initialized GCS Bucket target: ${config.evidenceBucket}`);
  return { bucketName: config.evidenceBucket };
}

if (require.main === module) {
  createBucketScript().catch(console.error);
}
