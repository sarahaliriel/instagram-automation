import { z } from "zod";
const id = z.string().regex(/^\d{1,64}$/);
const schema = z.object({
  INSTAGRAM_DELIVERY_MODE: z
    .enum(["disabled", "mock", "controlled_test"])
    .default("disabled"),
  INSTAGRAM_PUBLIC_FALLBACK_ENABLED: z.enum(["0", "1"]).default("0"),
  INSTAGRAM_DELIVERY_EXECUTION_ID: z.uuid().optional(),
  INSTAGRAM_DELIVERY_ACCOUNT_ID: id.optional(),
  INSTAGRAM_DELIVERY_COMMENT_ID: id.optional(),
  INSTAGRAM_DELIVERY_MEDIA_ID: id.optional(),
  INSTAGRAM_DELIVERY_APPROVAL_ID: z.uuid().optional(),
  INSTAGRAM_DELIVERY_PREPARATION_SHA256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  INSTAGRAM_DELIVERY_APPROVED_UNTIL: z.iso.datetime().optional(),
  INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED: z.enum(["0", "1"]).default("0"),
  INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: z.enum(["0", "1"]).default("0"),
});
export function parseDeliverySettings(
  input: Record<string, string | undefined>,
  now = new Date(),
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid delivery configuration");
  const result = parsed.data;
  if (
    result.INSTAGRAM_DELIVERY_MODE !== "disabled" &&
    input.NODE_ENV === "production"
  )
    throw new Error("Delivery is forbidden in production");
  if (result.INSTAGRAM_DELIVERY_MODE === "controlled_test") {
    if (
      result.INSTAGRAM_PUBLIC_FALLBACK_ENABLED !== "0" ||
      (input.JOBS_MODE && input.JOBS_MODE !== "disabled") ||
      (input.INSTAGRAM_INTEGRATION_MODE &&
        input.INSTAGRAM_INTEGRATION_MODE !== "disabled")
    )
      throw new Error("Controlled delivery requires isolated local controls");
    if (
      !result.INSTAGRAM_DELIVERY_EXECUTION_ID ||
      !result.INSTAGRAM_DELIVERY_ACCOUNT_ID ||
      !result.INSTAGRAM_DELIVERY_COMMENT_ID ||
      !result.INSTAGRAM_DELIVERY_MEDIA_ID ||
      !result.INSTAGRAM_DELIVERY_APPROVAL_ID ||
      !result.INSTAGRAM_DELIVERY_PREPARATION_SHA256 ||
      !result.INSTAGRAM_DELIVERY_APPROVED_UNTIL ||
      result.INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED !== "1" ||
      result.INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED !== "1"
    )
      throw new Error(
        "Controlled delivery requires explicit target and operator approval",
      );
    const expires = Date.parse(result.INSTAGRAM_DELIVERY_APPROVED_UNTIL);
    if (expires <= now.getTime() || expires > now.getTime() + 15 * 60_000)
      throw new Error(
        "Controlled delivery approval must expire within fifteen minutes",
      );
  }
  return Object.freeze(result);
}
export type DeliverySettings = ReturnType<typeof parseDeliverySettings>;
