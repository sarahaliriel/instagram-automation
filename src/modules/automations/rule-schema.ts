import { z } from "zod";
import { normalizeKeyword } from "./normalize";

export const messageTemplateSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .superRefine((value, context) => {
    // Application limits, not a statement of Meta delivery eligibility.
    if (
      !value ||
      !value.isWellFormed() ||
      new TextEncoder().encode(value).length > 1000 ||
      /[{}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Expected well-formed plain text of at most 1000 UTF-8 bytes without controls or placeholders",
      });
    }
  });
export const automationRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    accountId: z.uuid(),
    enabled: z.boolean().default(false),
    strategy: z.enum(["EXACT", "WHOLE_WORD"]),
    scope: z.enum(["GLOBAL", "MEDIA"]),
    mediaId: z.uuid().nullable().default(null),
    priority: z.number().int().min(-1000000).max(1000000).default(0),
    privateMessageTemplate: messageTemplateSchema,
    publicFallbackEnabled: z.boolean().default(false),
    publicFallbackTemplate: messageTemplateSchema.nullable().default(null),
    keywords: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((value) => value.isWellFormed()),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((rule, context) => {
    if ((rule.scope === "MEDIA") !== (rule.mediaId !== null))
      context.addIssue({
        code: "custom",
        path: ["mediaId"],
        message: "Media scope requires exactly one media",
      });
    const normalized = rule.keywords.map(normalizeKeyword);
    if (normalized.some((keyword) => !keyword || keyword.length > 200))
      context.addIssue({
        code: "custom",
        path: ["keywords"],
        message: "Invalid normalized keyword",
      });
    if (new Set(normalized).size !== normalized.length)
      context.addIssue({
        code: "custom",
        path: ["keywords"],
        message: "Duplicate normalized keywords",
      });
  });
export type AutomationRuleInput = z.input<typeof automationRuleSchema>;

// Administrative creation/editing is intentionally narrower than the engine
// fixture contract: one keyword, one owned publication and never enabled.
export const automationDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mediaProviderId: z.string().regex(/^\d{1,64}$/),
    strategy: z.enum(["EXACT", "WHOLE_WORD"]),
    keyword: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => value.isWellFormed()),
    privateMessageTemplate: messageTemplateSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    const normalized = normalizeKeyword(draft.keyword);
    if (!normalized || normalized.length > 200)
      context.addIssue({
        code: "custom",
        path: ["keyword"],
        message: "Invalid normalized keyword",
      });
  });

export type AutomationDraftInput = z.input<typeof automationDraftSchema>;
export class AutomationRuleValidationError extends Error {
  constructor() {
    super("Invalid automation rule configuration");
  }
}
export function parseAutomationRule(input: unknown) {
  const parsed = automationRuleSchema.safeParse(input);
  if (!parsed.success) throw new AutomationRuleValidationError();
  return parsed.data;
}
