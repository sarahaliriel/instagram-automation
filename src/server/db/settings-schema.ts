import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(ql)?:\/\//.test(value))
    .optional(),
  EVENT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  JOBS_MODE: z.enum(["disabled", "development"]).default("disabled"),
  INNGEST_DEV: z.enum(["0", "1"]).optional(),
});
export function parsePersistenceSettings(
  input: Record<string, string | undefined>,
) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid persistence configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  const settings = result.data;
  const ingestionEnabled = input.INSTAGRAM_INTEGRATION_MODE === "development";
  if (
    (ingestionEnabled || settings.JOBS_MODE === "development") &&
    (!settings.DATABASE_URL || !settings.EVENT_ENCRYPTION_KEY)
  ) {
    throw new Error(
      "DATABASE_URL and EVENT_ENCRYPTION_KEY are required for durable processing",
    );
  }
  if (
    settings.JOBS_MODE === "development" &&
    (input.NODE_ENV === "production" || settings.INNGEST_DEV !== "1")
  ) {
    throw new Error(
      "Background jobs require non-production mode and INNGEST_DEV=1",
    );
  }
  return Object.freeze(settings);
}
