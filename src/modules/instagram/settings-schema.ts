import { z } from "zod";

// Reviewed Unified Login documentation on 2026-11-18. Expand only after review.
export const apiVersionSchema = z.enum(["v26.0", "v27.0"]);
// Operation requirements, not evidence that a token has been granted these permissions.
// Configure permissions in Facebook Login for Business; never send them as legacy scopes.
export const unifiedLoginPermissions = Object.freeze({
  accountAndMedia: ["instagram_basic"] as const,
  comments: ["instagram_basic", "instagram_manage_comments"] as const,
  futurePrivateReplies: [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
  ] as const,
});
const secret = z.string().min(32).max(4096);
const id = z.string().regex(/^\d{1,64}$/);
const schema = z
  .object({
    INSTAGRAM_INTEGRATION_MODE: z
      .enum(["disabled", "development"])
      .default("disabled"),
    INSTAGRAM_ADMIN_READ_MODE: z
      .enum(["disabled", "development"])
      .default("disabled"),
    INSTAGRAM_AUTH_MODEL: z.literal("unified_login").default("unified_login"),
    META_LOGIN_CONFIG_ID: id.optional(),
    META_CLIENT_BUSINESS_ID: id.optional(),
    INSTAGRAM_API_VERSION: apiVersionSchema.default("v27.0"),
    META_WEBHOOK_APP_SECRET: secret.optional(),
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: secret.optional(),
    INSTAGRAM_ACCOUNT_ID: id.optional(),
    META_SYSTEM_USER_ACCESS_TOKEN: z.string().min(1).regex(/^\S+$/).optional(),
  })
  .superRefine((settings, context) => {
    if (settings.META_SYSTEM_USER_ACCESS_TOKEN) {
      for (const field of [
        "META_LOGIN_CONFIG_ID",
        "META_CLIENT_BUSINESS_ID",
      ] as const) {
        if (!settings[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Required for Unified Login token provenance",
          });
      }
    }
    if (settings.INSTAGRAM_INTEGRATION_MODE === "development") {
      for (const field of [
        "META_WEBHOOK_APP_SECRET",
        "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
        "INSTAGRAM_ACCOUNT_ID",
      ] as const) {
        if (!settings[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Required for development webhooks",
          });
      }
    }
    if (settings.INSTAGRAM_ADMIN_READ_MODE === "development") {
      for (const field of [
        "META_SYSTEM_USER_ACCESS_TOKEN",
        "META_LOGIN_CONFIG_ID",
        "META_CLIENT_BUSINESS_ID",
        "INSTAGRAM_ACCOUNT_ID",
      ] as const) {
        if (!settings[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Required for administrative Instagram reads",
          });
      }
    }
  });

export function parseInstagramSettings(
  input: Record<string, string | undefined>,
) {
  // Never reinterpret an old Instagram User token as a Unified Login token.
  if (input.INSTAGRAM_ACCESS_TOKEN !== undefined) {
    throw new Error(
      "Legacy INSTAGRAM_ACCESS_TOKEN is unsupported; reconnect with Unified Login",
    );
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Invalid Instagram configuration: ${[...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  }
  if (
    input.NODE_ENV === "production" &&
    (parsed.data.INSTAGRAM_INTEGRATION_MODE !== "disabled" ||
      parsed.data.INSTAGRAM_ADMIN_READ_MODE !== "disabled")
  ) {
    throw new Error(
      "Instagram development capabilities are forbidden in production",
    );
  }
  return Object.freeze(parsed.data);
}
