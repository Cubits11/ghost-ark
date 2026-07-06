import { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ValidationError } from "../../../../packages/shared/src/errors";

export function parseJsonBody<T>(body: string | undefined | null): T {
  if (!body) {
    throw new ValidationError("Request body is required");
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new ValidationError("Request body is not valid JSON", {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
