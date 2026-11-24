import { describe, expect, it } from "vitest";
import {
  openPreparation,
  sealPreparation,
  safePreparationSummary,
  privateReviewText,
  type ReplyPreparation,
} from "./reply-preparation";
const fixture: ReplyPreparation = {
  version: 1,
  executionId: "10000000-0000-4000-8000-000000000001",
  accountId: "1",
  mediaId: "2",
  commentId: "3",
  commentCreatedAt: "2026-11-19T10:00:00.000Z",
  mediaProduct: "FEED",
  commenter: "synthetic_commenter",
  businessIntegrationIdentity: "NOT_VERIFIED",
  clientBusinessId: "6",
  configurationId: "5",
  ruleId: "10000000-0000-4000-8000-000000000002",
  ruleName: "Synthetic rule",
  selectedRuleUpdatedAt: "2026-11-19T10:00:00.000Z",
  outgoingMessage: "Exact synthetic private message",
  preparedAt: "2026-11-19T10:01:00.000Z",
  requiredPermissions: [
    "instagram_basic",
    "instagram_manage_comments",
    "instagram_manage_messages",
  ],
  permissions: "NOT_VERIFIED",
  advancedAccess: "NOT_VERIFIED",
  approval: "NOT_GRANTED",
};
const key = "a".repeat(64);
describe("encrypted private reply preparation", () => {
  it("seals all target/message data without secrets and uses execution-bound authenticated encryption", () => {
    const sealed = sealPreparation(fixture, key);
    expect(sealed).not.toContain(fixture.outgoingMessage);
    expect(sealed).not.toContain(fixture.ruleName);
    expect(openPreparation(fixture.executionId, sealed, key)).toEqual(fixture);
    expect(() =>
      openPreparation("10000000-0000-4000-8000-000000000099", sealed, key),
    ).toThrow("cannot be opened");
    expect(() =>
      openPreparation(fixture.executionId, sealed, "b".repeat(64)),
    ).toThrow("cannot be opened");
  });
  it("refuses extra credential fields or forged approval", () => {
    expect(() =>
      sealPreparation(
        { ...fixture, accessToken: "synthetic-token" } as ReplyPreparation,
        key,
      ),
    ).toThrow("Invalid reply preparation");
    expect(() =>
      sealPreparation(
        { ...fixture, approval: "GRANTED" } as unknown as ReplyPreparation,
        key,
      ),
    ).toThrow("Invalid reply preparation");
  });
  it("returns safe statuses and leaves exact metadata/message for private GUI review", () => {
    const summary = JSON.stringify(safePreparationSummary(fixture));
    expect(summary).not.toContain(fixture.executionId);
    expect(summary).not.toContain(fixture.outgoingMessage);
    expect(summary).not.toContain(fixture.ruleName);
    const presentation = privateReviewText(fixture);
    expect(presentation).toContain(fixture.outgoingMessage);
    expect(presentation).toContain(fixture.executionId);
    expect(presentation).toContain("NÃO AUTORIZA ENVIO");
  });
});
