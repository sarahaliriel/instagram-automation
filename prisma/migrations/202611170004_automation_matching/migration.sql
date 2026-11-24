-- CreateEnum
CREATE TYPE "MatchingStrategy" AS ENUM ('EXACT', 'WHOLE_WORD');

-- CreateEnum
CREATE TYPE "MediaScope" AS ENUM ('GLOBAL', 'MEDIA');

-- DropForeignKey
ALTER TABLE "ProcessingExecution" DROP CONSTRAINT "ProcessingExecution_eventId_fkey";

-- AlterTable
ALTER TABLE "ProcessingExecution" ADD COLUMN     "accountId" UUID,
ADD COLUMN     "commentId" UUID,
ADD COLUMN     "engineVersion" VARCHAR(32) NOT NULL DEFAULT 'legacy-phase4',
ADD COLUMN     "intentCiphertext" TEXT,
ADD COLUMN     "matchedKeywordId" UUID,
ADD COLUMN     "selectedRuleId" UUID,
ADD COLUMN     "selectedRuleUpdatedAt" TIMESTAMPTZ(3);

-- Preserve every historical execution and its original decision.
UPDATE "ProcessingExecution" AS x
SET "accountId" = e."accountId", "commentId" = e."commentId"
FROM "WebhookEvent" AS e WHERE e.id = x."eventId";
ALTER TABLE "ProcessingExecution"
  ALTER COLUMN "accountId" SET NOT NULL,
  ALTER COLUMN "commentId" SET NOT NULL,
  ALTER COLUMN "engineVersion" SET DEFAULT 'matching-v1';

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "strategy" "MatchingStrategy" NOT NULL,
    "scope" "MediaScope" NOT NULL,
    "mediaId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "privateMessageTemplateCiphertext" TEXT NOT NULL,
    "publicFallbackTemplateCiphertext" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationKeyword" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "originalKeyword" VARCHAR(200) NOT NULL,
    "normalizedKeyword" VARCHAR(200) NOT NULL,

    CONSTRAINT "AutomationKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_accountId_enabled_scope_mediaId_idx" ON "AutomationRule"("accountId", "enabled", "scope", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_id_accountId_key" ON "AutomationRule"("id", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationKeyword_ruleId_normalizedKeyword_key" ON "AutomationKeyword"("ruleId", "normalizedKeyword");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationKeyword_id_ruleId_key" ON "AutomationKeyword"("id", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingExecution_commentId_key" ON "ProcessingExecution"("commentId");

-- CreateIndex
CREATE INDEX "ProcessingExecution_state_createdAt_idx" ON "ProcessingExecution"("state", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessingExecution_selectedRuleId_accountId_idx" ON "ProcessingExecution"("selectedRuleId", "accountId");

-- CreateIndex
CREATE INDEX "ProcessingExecution_matchedKeywordId_selectedRuleId_idx" ON "ProcessingExecution"("matchedKeywordId", "selectedRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingExecution_eventId_accountId_commentId_key" ON "ProcessingExecution"("eventId", "accountId", "commentId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_id_accountId_commentId_key" ON "WebhookEvent"("id", "accountId", "commentId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_mediaId_accountId_fkey" FOREIGN KEY ("mediaId", "accountId") REFERENCES "InstagramMedia"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationKeyword" ADD CONSTRAINT "AutomationKeyword_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingExecution" ADD CONSTRAINT "ProcessingExecution_eventId_accountId_commentId_fkey" FOREIGN KEY ("eventId", "accountId", "commentId") REFERENCES "WebhookEvent"("id", "accountId", "commentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingExecution" ADD CONSTRAINT "ProcessingExecution_selectedRuleId_accountId_fkey" FOREIGN KEY ("selectedRuleId", "accountId") REFERENCES "AutomationRule"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingExecution" ADD CONSTRAINT "ProcessingExecution_matchedKeywordId_selectedRuleId_fkey" FOREIGN KEY ("matchedKeywordId", "selectedRuleId") REFERENCES "AutomationKeyword"("id", "ruleId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Application invariants remain enforced for direct database writes as well.
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_scope_media" CHECK (
  (scope = 'GLOBAL' AND "mediaId" IS NULL) OR (scope = 'MEDIA' AND "mediaId" IS NOT NULL)
);
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_priority_range" CHECK (priority BETWEEN -1000000 AND 1000000);
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_nonempty_configuration" CHECK (
  length(btrim(name)) > 0 AND length("privateMessageTemplateCiphertext") > 0
  AND ("publicFallbackTemplateCiphertext" IS NULL OR length("publicFallbackTemplateCiphertext") > 0)
);
ALTER TABLE "AutomationKeyword" ADD CONSTRAINT "AutomationKeyword_nonempty" CHECK (
  length(btrim("originalKeyword")) > 0 AND length(btrim("normalizedKeyword")) > 0
);
ALTER TABLE "ProcessingExecution" ADD CONSTRAINT "ProcessingExecution_matching_decision" CHECK (
  ("engineVersion" = 'legacy-phase4' AND state <> 'READY_FOR_DELIVERY'
    AND "selectedRuleId" IS NULL AND "matchedKeywordId" IS NULL
    AND "selectedRuleUpdatedAt" IS NULL AND "intentCiphertext" IS NULL)
  OR ("engineVersion" = 'matching-v1' AND (
    (state = 'READY_FOR_DELIVERY' AND "selectedRuleId" IS NOT NULL AND "matchedKeywordId" IS NOT NULL
      AND "selectedRuleUpdatedAt" IS NOT NULL AND "intentCiphertext" IS NOT NULL)
    OR (state = 'SKIPPED' AND "selectedRuleId" IS NULL AND "matchedKeywordId" IS NULL
      AND "selectedRuleUpdatedAt" IS NULL AND "intentCiphertext" IS NULL)
  ))
);
