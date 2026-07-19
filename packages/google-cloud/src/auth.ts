import { GoogleCloudConfig } from "./config";
import { CloudError } from "./errors";

export interface AuthClientInfo {
  projectId: string;
  keyFilename?: string;
  hasCredentials: boolean;
}

export function getAuthInfo(config: GoogleCloudConfig): AuthClientInfo {
  const hasCredentials = Boolean(
    config.keyFilename ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GCP_SERVICE_ACCOUNT_KEY
  );

  return {
    projectId: config.projectId,
    keyFilename: config.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS,
    hasCredentials
  };
}

export function validateCloudAuth(config: GoogleCloudConfig): void {
  const info = getAuthInfo(config);
  if (!info.projectId) {
    throw new CloudError("Missing GCP project ID in Google Cloud configuration.");
  }
}
