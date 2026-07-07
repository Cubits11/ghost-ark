export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const sensitiveFieldPattern = /(authorization|body|completion|cookie|memory|password|prompt|raw|secret|token|transcript)/iu;

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        sensitiveFieldPattern.test(key) ? "[REDACTED]" : redactForLog(entryValue)
      ])
    );
  }
  return value;
}

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...(redactForLog(fields) as Record<string, unknown>)
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export function createLogger(defaultFields: Record<string, unknown> = {}): Logger {
  return {
    debug: (message, fields) => write("debug", message, { ...defaultFields, ...fields }),
    info: (message, fields) => write("info", message, { ...defaultFields, ...fields }),
    warn: (message, fields) => write("warn", message, { ...defaultFields, ...fields }),
    error: (message, fields) => write("error", message, { ...defaultFields, ...fields })
  };
}
