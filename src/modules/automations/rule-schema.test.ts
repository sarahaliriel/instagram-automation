import { describe, expect, it } from "vitest";
import {
  automationDraftSchema,
  automationRuleSchema,
  messageTemplateSchema,
  parseAutomationRule,
} from "./rule-schema";
import { automationRuleFixture } from "../../../tests/fixtures/automation-rules";
const account = "20000000-0000-4000-8000-000000000001";
describe("rule and template validation", () => {
  it("normalizes template line endings and preserves plain text", () =>
    expect(messageTemplateSchema.parse("  hello\r\nworld  ")).toBe(
      "hello\nworld",
    ));
  it.each([
    "",
    " ",
    "hello {{name}}",
    "${name}",
    "bad\u0000text",
    "bad\u007ftext",
    "\ud800",
    "😀".repeat(251),
  ])("rejects invalid templates without echoing them", (value) => {
    expect(messageTemplateSchema.safeParse(value).success).toBe(false);
    expect(() =>
      parseAutomationRule(
        automationRuleFixture(account, { privateMessageTemplate: value }),
      ),
    ).toThrow("Invalid automation rule configuration");
  });
  it("counts UTF-8 bytes rather than UTF-16 units", () =>
    expect(messageTemplateSchema.safeParse("😀".repeat(250)).success).toBe(
      true,
    ));
  it("rejects a supplied invalid fallback template", () =>
    expect(
      automationRuleSchema.safeParse(
        automationRuleFixture(account, {
          publicFallbackTemplate: "{{username}}",
        }),
      ).success,
    ).toBe(false));
  it("defaults rules to disabled and rejects ambiguous media scopes", () => {
    const input = automationRuleFixture(account);
    delete input.enabled;
    expect(parseAutomationRule(input).enabled).toBe(false);
    expect(() =>
      parseAutomationRule({ ...input, scope: "MEDIA", mediaId: null }),
    ).toThrow();
    expect(() => parseAutomationRule({ ...input, mediaId: account })).toThrow();
  });
  it.each(
    [
      [],
      ["FORMULÁRIO", " formulario "],
      ["\u0301"],
      ["a".repeat(201)],
      Array(51).fill("keyword"),
    ].map((keywords) => [keywords]),
  )(
    "rejects missing, normalized duplicate or oversized keyword sets",
    (keywords) =>
      expect(() =>
        parseAutomationRule(automationRuleFixture(account, { keywords })),
      ).toThrow(),
  );
  it("rejects out-of-range priorities and unknown keys", () => {
    expect(() =>
      parseAutomationRule(
        automationRuleFixture(account, { priority: 1000001 }),
      ),
    ).toThrow();
    expect(() =>
      parseAutomationRule({ ...automationRuleFixture(account), sendNow: true }),
    ).toThrow();
  });
  it("validates the narrow draft contract and normalizes its keyword", () => {
    const result = automationDraftSchema.parse({
      name: "  Pedido de catálogo  ",
      mediaProviderId: "123456789",
      strategy: "WHOLE_WORD",
      keyword: "  FORMULÁRIO  ",
      privateMessageTemplate: "  Mensagem privada.  ",
    });
    expect(result).toMatchObject({
      name: "Pedido de catálogo",
      keyword: "FORMULÁRIO",
      privateMessageTemplate: "Mensagem privada.",
    });
  });
  it("rejects arbitrary publication IDs and activation fields in drafts", () => {
    expect(
      automationDraftSchema.safeParse({
        name: "Draft",
        mediaProviderId: "not-a-meta-id",
        strategy: "EXACT",
        keyword: "info",
        privateMessageTemplate: "Mensagem.",
      }).success,
    ).toBe(false);
    expect(
      automationDraftSchema.safeParse({
        name: "Draft",
        mediaProviderId: "123",
        strategy: "EXACT",
        keyword: "info",
        privateMessageTemplate: "Mensagem.",
        enabled: true,
      }).success,
    ).toBe(false);
  });
});
