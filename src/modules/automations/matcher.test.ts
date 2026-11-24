import { describe, expect, it } from "vitest";
import { matchAutomation, type MatchingRule } from "./matcher";
import { normalizeKeyword } from "./normalize";
import { RULE_IDS } from "../../../tests/fixtures/automation-rules";
const keyword = (value: string, id = value) => ({
  id,
  normalizedKeyword: normalizeKeyword(value),
});
const rule = (overrides: Partial<MatchingRule> = {}): MatchingRule => ({
  id: RULE_IDS.first,
  accountId: "account",
  enabled: true,
  strategy: "EXACT",
  scope: "GLOBAL",
  mediaId: null,
  priority: 0,
  keywords: [keyword("FORMULÁRIO", "keyword")],
  ...overrides,
});
const match = (
  text: string | null | undefined,
  rules: MatchingRule[] = [rule()],
) => matchAutomation({ accountId: "account", mediaId: "media", text }, rules);

describe("normalization", () => {
  it.each([
    "FORMULÁRIO",
    "formulario",
    " Formulário ",
    "FORMULA\u0301RIO",
    "ＦＯＲＭＵＬＡＲＩＯ",
  ])("normalizes %s identically", (text) =>
    expect(normalizeKeyword(text)).toBe("formulario"),
  );
  it("normalizes Unicode whitespace, compatibility forms and accents without transliterating scripts", () => {
    expect(normalizeKeyword("\uFEFF JOÃO\u00a0\t\n SILVA ")).toBe("joao silva");
    expect(normalizeKeyword("ﬁcha")).toBe("ficha");
    expect(normalizeKeyword("ΆΛΦΑ")).toBe("αλφα");
    expect(normalizeKeyword("Straße")).toBe("straße"); // Unicode lowercase, not full case folding.
    expect(normalizeKeyword("情報")).toBe("情報");
  });
});
describe("exact matching", () => {
  it.each(["FORMULÁRIO", " formulario ", "Formulário"])("matches %s", (text) =>
    expect(match(text).kind).toBe("MATCHED"),
  );
  it.each(["formulario!", "quero formulario", "formularios"])(
    "requires the whole normalized comment: %s",
    (text) => expect(match(text).kind).toBe("SKIPPED"),
  );
  it("supports multiple keywords with OR semantics and a stable keyword choice", () => {
    const candidate = rule({
      strategy: "WHOLE_WORD",
      keywords: [keyword("zeta", "z"), keyword("info", "i")],
    });
    expect(match("zeta info info", [candidate])).toEqual({
      kind: "MATCHED",
      ruleId: candidate.id,
      keywordId: "i",
    });
    expect(match("INFO", [candidate]).kind).toBe("MATCHED");
  });
});
describe("whole-word and phrase boundaries", () => {
  const info = rule({ strategy: "WHOLE_WORD", keywords: [keyword("INFO")] });
  it.each([
    "info",
    "quero INFO!",
    "(info)",
    "#info",
    "info-extra",
    "info😀",
    "d'info",
    "info info",
  ])("matches explicit boundaries: %s", (text) =>
    expect(match(text, [info]).kind).toBe("MATCHED"),
  );
  it.each([
    "INFORMAÇÕES",
    "desinfo",
    "info2",
    "_info_",
    "情報info",
    "info情報",
    "𐐀info",
    "info𐐀",
  ])("rejects embedded Unicode word text: %s", (text) =>
    expect(match(text, [info]).kind).toBe("SKIPPED"),
  );
  it("matches literal multiword phrases across normalized whitespace", () => {
    const candidate = rule({
      strategy: "WHOLE_WORD",
      keywords: [keyword("job form")],
    });
    expect(match("quero job\n\tform!", [candidate]).kind).toBe("MATCHED");
    expect(match("job-form", [candidate]).kind).toBe("SKIPPED");
  });
  it("treats regex syntax and punctuation literally", () => {
    const candidate = rule({
      strategy: "WHOLE_WORD",
      keywords: [keyword("c++")],
    });
    expect(match("quero c++!", [candidate]).kind).toBe("MATCHED");
    expect(match("c language", [candidate]).kind).toBe("SKIPPED");
    expect(match("c++extra", [candidate]).kind).toBe("SKIPPED");
  });
  it("does not broaden CJK words into arbitrary substrings", () => {
    const candidate = rule({
      strategy: "WHOLE_WORD",
      keywords: [keyword("情報")],
    });
    expect(match("情報", [candidate]).kind).toBe("MATCHED");
    expect(match("情報提供", [candidate]).kind).toBe("SKIPPED");
  });
  it("handles many rejected occurrences without changing the boundary result", () => {
    const candidate = rule({
      strategy: "WHOLE_WORD",
      keywords: [keyword("a")],
    });
    expect(match("a".repeat(100000), [candidate]).kind).toBe("SKIPPED");
  });
});
describe("scope and precedence", () => {
  it("prefers a matching media rule over a higher-priority global rule", () => {
    const global = rule({ id: RULE_IDS.first, priority: 1000 });
    const media = rule({
      id: RULE_IDS.second,
      scope: "MEDIA",
      mediaId: "media",
      priority: -1000,
    });
    expect(match("formulario", [global, media])).toMatchObject({
      ruleId: media.id,
    });
  });
  it("permits a global winner if the media-specific keyword does not match", () => {
    expect(
      match("formulario", [
        rule({
          id: RULE_IDS.second,
          scope: "MEDIA",
          mediaId: "media",
          keywords: [keyword("other")],
        }),
        rule(),
      ]),
    ).toMatchObject({ ruleId: RULE_IDS.first });
  });
  it("uses descending priority, then ascending stable UUID, independent of input order", () => {
    const first = rule({ id: RULE_IDS.first, priority: 2 });
    const second = rule({ id: RULE_IDS.second, priority: 2 });
    const lower = rule({ id: RULE_IDS.third, priority: 1 });
    for (const candidates of [
      [second, lower, first],
      [first, second, lower],
      [lower, first, second],
    ])
      expect(match("formulario", candidates)).toMatchObject({
        ruleId: RULE_IDS.first,
      });
  });
  it("excludes disabled rules, other accounts and other media", () => {
    expect(
      match("formulario", [
        rule({ enabled: false }),
        rule({ accountId: "other" }),
        rule({ scope: "MEDIA", mediaId: "other" }),
      ]).kind,
    ).toBe("SKIPPED");
  });
  it("does not mutate caller-owned rules or keywords", () => {
    const candidate = rule({ keywords: [keyword("z"), keyword("a")] });
    const before = JSON.stringify(candidate);
    match("a", [candidate]);
    expect(JSON.stringify(candidate)).toBe(before);
  });
  it.each([null, undefined])("skips absent comment text", (text) =>
    expect(match(text)).toEqual({
      kind: "SKIPPED",
      reason: "COMMENT_WITHOUT_TEXT",
    }),
  );
  it.each(["", " \n\t ", "\u00a0"])("skips empty normalized text", (text) =>
    expect(match(text)).toEqual({ kind: "SKIPPED", reason: "EMPTY_COMMENT" }),
  );
});
