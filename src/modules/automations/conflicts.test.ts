import { describe, expect, it } from "vitest";
import { analyzeMatchingConflicts, type ConflictRule } from "./conflicts";

const candidate: ConflictRule = {
  id: "20000000-0000-4000-8000-000000000000",
  name: "Candidate",
  scope: "MEDIA",
  mediaId: "media-1",
  priority: 0,
  revision: 1,
  strategy: "EXACT",
  keywords: ["formulario"],
};

describe("automation conflict analysis", () => {
  it("reports shared normalized keywords and matcher precedence", () => {
    expect(
      analyzeMatchingConflicts(candidate, [
        {
          ...candidate,
          id: "10000000-0000-4000-8000-000000000000",
          name: "Existing media rule",
        },
        {
          ...candidate,
          id: "30000000-0000-4000-8000-000000000000",
          name: "Global high priority",
          scope: "GLOBAL",
          mediaId: null,
          priority: 100,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        name: "Existing media rule",
        precedence: "EXISTING_RULE_WINS",
        overlappingKeywords: ["formulario ↔ formulario"],
      }),
      expect.objectContaining({
        name: "Global high priority",
        precedence: "CANDIDATE_WINS",
      }),
    ]);
  });

  it("detects different whole-word keywords that may match one comment", () => {
    expect(
      analyzeMatchingConflicts(
        { ...candidate, strategy: "WHOLE_WORD", keywords: ["guia"] },
        [
          {
            ...candidate,
            id: "whole-word-existing",
            strategy: "WHOLE_WORD",
            keywords: ["formulario"],
          },
        ],
      ),
    ).toEqual([
      expect.objectContaining({
        overlappingKeywords: ["guia ↔ formulario"],
      }),
    ]);
  });

  it("checks media-specific rules when reviewing a global rule", () => {
    expect(
      analyzeMatchingConflicts(
        { ...candidate, scope: "GLOBAL", mediaId: null },
        [{ ...candidate, id: "media-existing" }],
      ),
    ).toHaveLength(1);
  });

  it("ignores other publications and non-overlapping keywords", () => {
    expect(
      analyzeMatchingConflicts(candidate, [
        { ...candidate, id: "other-media", mediaId: "media-2" },
        {
          ...candidate,
          id: "other-keyword",
          keywords: ["guia"],
        },
      ]),
    ).toEqual([]);
  });
});
