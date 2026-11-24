-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('PENDING_DELIVERY', 'SENDING', 'ACCEPTED_BY_META', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'UNKNOWN_OUTCOME', 'FALLBACK_ELIGIBLE', 'FALLBACK_ACCEPTED_BY_META', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "DeliveryKind" AS ENUM ('PRIVATE_REPLY', 'PUBLIC_FALLBACK');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('MOCK', 'CONTROLLED_TEST');

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "publicFallbackEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeliveryAction" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "state" "DeliveryState" NOT NULL DEFAULT 'PENDING_DELIVERY',
    "mode" "DeliveryMode" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "activeAttemptId" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" VARCHAR(64),
    "operationIdCiphertext" TEXT,
    "rejectionEvidenceId" UUID,
    "approvalId" UUID,
    "approvedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeliveryAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttempt" (
    "id" UUID NOT NULL,
    "actionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "state" "DeliveryState" NOT NULL,
    "errorCode" VARCHAR(64),
    "httpStatus" INTEGER,
    "metaCode" INTEGER,
    "metaSubcode" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "MessageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryAction_state_nextAttemptAt_idx" ON "DeliveryAction"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "DeliveryAction_state_leaseExpiresAt_idx" ON "DeliveryAction"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAction_executionId_kind_key" ON "DeliveryAction"("executionId", "kind");

-- CreateIndex
CREATE INDEX "MessageAttempt_actionId_createdAt_idx" ON "MessageAttempt"("actionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttempt_actionId_number_key" ON "MessageAttempt"("actionId", "number");

-- AddForeignKey
ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ProcessingExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "DeliveryAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_lease" CHECK (
  (state = 'SENDING' AND "activeAttemptId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
  OR (state <> 'SENDING' AND "activeAttemptId" IS NULL AND "leaseExpiresAt" IS NULL)
);
ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_attempts" CHECK (attempts >= 0 AND attempts <= 3);
ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_approval" CHECK (
  (mode = 'MOCK' AND "approvalId" IS NULL AND "approvedUntil" IS NULL)
  OR (mode = 'CONTROLLED_TEST' AND "approvalId" IS NOT NULL AND "approvedUntil" IS NOT NULL)
);
ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_evidence" CHECK (
  (kind = 'PRIVATE_REPLY' AND "rejectionEvidenceId" IS NULL)
  OR (kind = 'PUBLIC_FALLBACK' AND "rejectionEvidenceId" IS NOT NULL)
);
ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_acceptance" CHECK (
  (state IN ('ACCEPTED_BY_META', 'FALLBACK_ACCEPTED_BY_META') AND "operationIdCiphertext" IS NOT NULL)
  OR (state NOT IN ('ACCEPTED_BY_META', 'FALLBACK_ACCEPTED_BY_META') AND "operationIdCiphertext" IS NULL)
);
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_number" CHECK (number BETWEEN 1 AND 3);
ALTER TABLE "MessageAttempt" ADD CONSTRAINT "MessageAttempt_completion" CHECK (
  (state = 'SENDING' AND "completedAt" IS NULL)
  OR (state <> 'SENDING' AND "completedAt" IS NOT NULL)
);

ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_rejectionEvidenceId_fkey" FOREIGN KEY ("rejectionEvidenceId") REFERENCES "MessageAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryAction" ADD CONSTRAINT "DeliveryAction_kind_state" CHECK (
  (kind = 'PRIVATE_REPLY' AND state <> 'FALLBACK_ACCEPTED_BY_META')
  OR (kind = 'PUBLIC_FALLBACK' AND state NOT IN ('ACCEPTED_BY_META', 'FALLBACK_ELIGIBLE'))
);
