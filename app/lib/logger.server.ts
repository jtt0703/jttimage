import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "lens-cart-ai",
    env: process.env.NODE_ENV ?? "development",
  },
});

export function errorLogFields(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: process.env.NODE_ENV === "production" ? undefined : error.stack,
    };
  }
  return {
    errorName: "UnknownError",
    errorMessage: String(error),
  };
}

export function hashLogValue(value: string | null | undefined): string | null {
  if (!value) return null;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
