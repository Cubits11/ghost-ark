export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function write(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...fields
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
