const SECRET_KEYS = ["authorization", "token", "secret", "password", "cookie", "api-key", "apikey"];

const shouldRedact = (key: string) => {
  const lower = key.toLowerCase();
  return SECRET_KEYS.some((secretKey) => lower.includes(secretKey));
};

export const redactObject = (input: Record<string, unknown>) => {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (shouldRedact(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = redactObject(value as Record<string, unknown>);
      continue;
    }

    output[key] = value;
  }

  return output;
};
