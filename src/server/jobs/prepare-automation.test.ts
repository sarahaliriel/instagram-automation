import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { prepareAutomation } from "./prepare-automation";
import {
  TemporalEvidencePendingError,
  TemporalEvidenceReviewError,
} from "./retry-policy";

vi.mock("@/server/db/encryption", () => ({
  commentEncryptionContext: () => "context",
  decryptCommentText: () => "FORMULÁRIO",
}));
const activation = new Date("2026-01-01T00:00:00Z");
const receipt = new Date("2026-01-01T00:00:10Z");
const rule = {
  id: "rule",
  accountId: "account",
  enabled: true,
  activatedAt: activation,
  scope: "GLOBAL",
  mediaId: null,
  keywords: [
    {
      id: "keyword",
      originalKeyword: "FORMULÁRIO",
      normalizedKeyword: "formulario",
    },
  ],
};
const tx = {
  automationRule: { findMany: vi.fn(async () => [rule]) },
} as unknown as Prisma.TransactionClient;
const stored = (providerCreatedAt: Date | null) =>
  ({
    id: "event",
    accountId: "account",
    commentId: "comment",
    providerCommentId: "123",
    createdAt: receipt,
    account: { providerId: "456" },
    comment: {
      mediaId: "media",
      textCiphertext: "ciphertext",
      providerCreatedAt,
    },
  }) as unknown as Parameters<typeof prepareAutomation>[1];

describe("temporal evidence before matching", () => {
  it("keeps missing webhook evidence retryable", async () => {
    await expect(
      prepareAutomation(tx, stored(null), "key"),
    ).rejects.toBeInstanceOf(TemporalEvidencePendingError);
  });
  it("requires review for a creation after local receipt", async () => {
    await expect(
      prepareAutomation(tx, stored(new Date("2026-01-01T00:00:11Z")), "key"),
    ).rejects.toBeInstanceOf(TemporalEvidenceReviewError);
  });
  it("rejects a proved pre-activation comment without an intent", async () => {
    const result = await prepareAutomation(
      tx,
      stored(new Date("2025-12-31T23:59:59Z")),
      "key",
    );
    expect(result).toMatchObject({
      state: "SKIPPED",
      temporalIneligible: true,
    });
  });
});
