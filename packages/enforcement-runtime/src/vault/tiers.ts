import { z } from "zod";

export const memoryTiers = ["KAPPA", "SESSION", "CONSTITUTION", "AUDIT", "RESTRICTED"] as const;
export const memoryTierSchema = z.enum(memoryTiers);
export type MemoryTier = z.infer<typeof memoryTierSchema>;

export interface MemoryRecord {
  id: string;
  tenantId: string;
  userId: string;
  sessionId?: string;
  tier: MemoryTier;
  contentDigest: string;
  classificationTags: string[];
  createdAt: string;
  expiresAt?: string;
  tombstonedAt?: string;
}
