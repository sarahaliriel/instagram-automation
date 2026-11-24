-- Phase 7B keeps AutomationRule as the sole rule source of truth.
-- A disabled, non-archived rule is a draft; enabled rules are retained for
-- compatibility with existing matching decisions; archived rules stay durable.
ALTER TABLE "AutomationRule"
  ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_revision_positive"
  CHECK ("revision" > 0);
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_archived_disabled"
  CHECK ("archivedAt" IS NULL OR "enabled" = false);

CREATE INDEX "AutomationRule_accountId_archivedAt_updatedAt_idx"
  ON "AutomationRule"("accountId", "archivedAt", "updatedAt");
