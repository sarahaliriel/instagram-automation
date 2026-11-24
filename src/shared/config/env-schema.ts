import { z } from "zod";

const originSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    if (!URL.canParse(value)) {
      context.addIssue({ code: "custom", message: "Expected a valid origin" });
      return;
    }
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Expected an HTTP(S) origin without credentials, path, query, or fragment",
      });
    }
  });

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: originSchema.default("http://localhost:3000"),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === "production" && !env.APP_URL.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "HTTPS is required in production",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  input: Record<string, string | undefined>,
): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    // Never include input values or the raw Zod error: future fields may be secrets.
    throw new Error(`Invalid environment configuration: ${fields.join(", ")}`);
  }
  return Object.freeze(result.data);
}
