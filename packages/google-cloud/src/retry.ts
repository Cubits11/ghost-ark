import { CloudError } from "./errors";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  isRetryable?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 2000;
  const factor = options.factor ?? 2;
  const isRetryable = options.isRetryable ?? (() => true);

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > maxRetries || !isRetryable(err)) {
        throw err instanceof CloudError
          ? err
          : new CloudError(`Operation failed after ${attempt} attempt(s): ${String(err)}`, { originalError: err });
      }
      const jitter = Math.random() * 0.2 * delay;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay + jitter, maxDelayMs)));
      delay *= factor;
    }
  }
}
