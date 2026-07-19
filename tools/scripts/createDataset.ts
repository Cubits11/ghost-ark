import { loadGoogleCloudConfig } from "../../packages/google-cloud/src";

export async function createDatasetScript() {
  const config = loadGoogleCloudConfig();
  console.log(`[Script] Initialized BigQuery Dataset target: ${config.datasetId} in project ${config.projectId}`);
  return { datasetId: config.datasetId, projectId: config.projectId };
}

if (require.main === module) {
  createDatasetScript().catch(console.error);
}
