export class CloudError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "CloudError";
  }
}

export class StorageError extends CloudError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = "StorageError";
  }
}

export class BigQueryError extends CloudError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = "BigQueryError";
  }
}

export class CloudValidationError extends CloudError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = "CloudValidationError";
  }
}
