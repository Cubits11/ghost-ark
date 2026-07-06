import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LineageEvent, validateLineageEvent } from "../../../../packages/lineage-model/src/events";

export interface LineageRepositoryOptions {
  tableName: string;
  client?: DynamoDBDocumentClient;
}

export class LineageRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: LineageRepositoryOptions) {
    this.tableName = options.tableName;
    this.client = options.client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(event: LineageEvent): Promise<void> {
    const validated = validateLineageEvent(event);
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...validated,
          sourceKeys: validated.inputs,
          targetKeys: validated.outputs
        },
        ConditionExpression: "attribute_not_exists(tenantSlug) AND attribute_not_exists(eventId)"
      })
    );
  }

  async listByTenant(tenantSlug: string, limit = 100): Promise<LineageEvent[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "tenantSlug = :tenantSlug",
        ExpressionAttributeValues: { ":tenantSlug": tenantSlug },
        Limit: limit,
        ScanIndexForward: false
      })
    );
    return (response.Items ?? []).map(validateLineageEvent);
  }
}
