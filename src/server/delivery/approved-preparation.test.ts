import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { encryptDeliveryIntent } from "@/server/db/delivery-intent";
import {
  sealPreparation,
  type ReplyPreparation,
} from "@/server/meta/reply-preparation";
import { parseDeliverySettings } from "./settings-schema";
import { loadApprovedPreparation } from "./approved-preparation";

const key = "a".repeat(64);
const executionId = "10000000-0000-4000-8000-000000000001";
const ruleId = "10000000-0000-4000-8000-000000000002";
const keywordId = "10000000-0000-4000-8000-000000000003";
const ruleTime = "2026-11-20T10:00:00.000Z";
const message = "Exact synthetic message";
function fixture(): ReplyPreparation {
  return {
    version: 1,
    executionId,
    accountId: "1",
    mediaId: "3",
    commentId: "2",
    commentCreatedAt: new Date(Date.now() - 1000).toISOString(),
    mediaProduct: "FEED",
    commenter: "synthetic_commenter",
    businessIntegrationIdentity: "NOT_VERIFIED",
    clientBusinessId: "6",
    configurationId: "5",
    ruleId,
    ruleName: "Synthetic",
    selectedRuleUpdatedAt: ruleTime,
    outgoingMessage: message,
    preparedAt: new Date().toISOString(),
    requiredPermissions: [
      "instagram_basic",
      "instagram_manage_comments",
      "instagram_manage_messages",
    ],
    permissions: "NOT_VERIFIED",
    advancedAccess: "NOT_VERIFIED",
    approval: "NOT_GRANTED",
  };
}
function database() {
  return {
    automationExecution: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: executionId,
        state: "READY_FOR_DELIVERY",
        selectedRuleId: ruleId,
        selectedRuleUpdatedAt: new Date(ruleTime),
        selectedRule: { enabled: true, updatedAt: new Date(ruleTime) },
        intentCiphertext: encryptDeliveryIntent(
          executionId,
          {
            version: 1,
            engineVersion: "matching-v1",
            ruleId,
            keywordId,
            strategy: "EXACT",
            scope: "MEDIA",
            priority: 100,
            normalizedKeyword: "formulario",
            accountId: "1",
            commentId: "2",
            privateMessage: message,
            publicFallbackMessage: null,
          },
          key,
        ),
        event: {
          source: "MANUAL_GET",
          providerCommentId: "2",
          account: { providerId: "1" },
          comment: { media: { providerId: "3" } },
        },
      }),
    },
  } as unknown as PrismaClient;
}
afterEach(() => vi.unstubAllEnvs());
describe("approved controlled preparation", () => {
  it("requires the reviewed digest and matching frozen message and target", async () => {
    vi.stubEnv("META_CLIENT_BUSINESS_ID", "6");
    vi.stubEnv("META_LOGIN_CONFIG_ID", "5");
    const directory = await mkdtemp(join(tmpdir(), "approved-preparation-"));
    try {
      const preparation = fixture();
      const ciphertext = sealPreparation(preparation, key);
      const path = join(directory, `${executionId}.enc`);
      await writeFile(path, ciphertext, { mode: 0o600 });
      const digest = createHash("sha256").update(ciphertext).digest("hex");
      const flags = parseDeliverySettings({
        INSTAGRAM_DELIVERY_MODE: "controlled_test",
        INSTAGRAM_DELIVERY_EXECUTION_ID: executionId,
        INSTAGRAM_DELIVERY_ACCOUNT_ID: "1",
        INSTAGRAM_DELIVERY_MEDIA_ID: "3",
        INSTAGRAM_DELIVERY_COMMENT_ID: "2",
        INSTAGRAM_DELIVERY_APPROVAL_ID: ruleId,
        INSTAGRAM_DELIVERY_PREPARATION_SHA256: digest,
        INSTAGRAM_DELIVERY_APPROVED_UNTIL: new Date(
          Date.now() + 300000,
        ).toISOString(),
        INSTAGRAM_DELIVERY_CREDENTIALS_VERIFIED: "1",
        INSTAGRAM_DELIVERY_PERMISSIONS_VERIFIED: "1",
      });
      expect(
        (await loadApprovedPreparation(database(), key, flags, directory))
          .outgoingMessage,
      ).toBe(message);
      await writeFile(path, ciphertext + "x");
      await expect(
        loadApprovedPreparation(database(), key, flags, directory),
      ).rejects.toThrow("digest mismatch");
      await writeFile(path, ciphertext);
      const changed = database();
      const row = await changed.automationExecution.findUniqueOrThrow({
        where: { id: executionId },
      });
      row.intentCiphertext = encryptDeliveryIntent(
        executionId,
        {
          version: 1,
          engineVersion: "matching-v1",
          ruleId,
          keywordId,
          strategy: "EXACT",
          scope: "MEDIA",
          priority: 100,
          normalizedKeyword: "formulario",
          accountId: "1",
          commentId: "2",
          privateMessage: "Changed synthetic message",
          publicFallbackMessage: null,
        },
        key,
      );
      await expect(
        loadApprovedPreparation(changed, key, flags, directory),
      ).rejects.toThrow("no longer matches");
      await expect(
        loadApprovedPreparation(database(), "b".repeat(64), flags, directory),
      ).rejects.toThrow();
      await expect(
        loadApprovedPreparation(
          database(),
          key,
          { ...flags, INSTAGRAM_DELIVERY_ACCOUNT_ID: "9" },
          directory,
        ),
      ).rejects.toThrow("no longer matches");
      await expect(
        loadApprovedPreparation(
          database(),
          key,
          { ...flags, INSTAGRAM_DELIVERY_COMMENT_ID: "9" },
          directory,
        ),
      ).rejects.toThrow("no longer matches");
      const expired = sealPreparation(
        {
          ...preparation,
          commentCreatedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
        },
        key,
      );
      await writeFile(path, expired);
      await expect(
        loadApprovedPreparation(
          database(),
          key,
          {
            ...flags,
            INSTAGRAM_DELIVERY_PREPARATION_SHA256: createHash("sha256")
              .update(expired)
              .digest("hex"),
          },
          directory,
        ),
      ).rejects.toThrow("no longer matches");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
