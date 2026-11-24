-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('INSTAGRAM');

-- CreateEnum
CREATE TYPE "EventState" AS ENUM ('RECEIVED', 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT', 'UNKNOWN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('PENDING', 'LEASED', 'DISPATCHED', 'COMPLETED');

-- CreateTable
CREATE TABLE "InstagramAccount" (
    "id" UUID NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'INSTAGRAM',
    "providerId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramMedia" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramComment" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "textCiphertext" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'INSTAGRAM',
    "accountId" UUID NOT NULL,
    "providerCommentId" VARCHAR(64) NOT NULL,
    "commentId" UUID NOT NULL,
    "notificationTime" BIGINT NOT NULL,
    "state" "EventState" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "state" "OutboxState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingExecution" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "state" "EventState" NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessingExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTransition" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "state" "EventState" NOT NULL,
    "code" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccount_provider_providerId_key" ON "InstagramAccount"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramMedia_accountId_providerId_key" ON "InstagramMedia"("accountId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramMedia_id_accountId_key" ON "InstagramMedia"("id", "accountId");

-- CreateIndex
CREATE INDEX "InstagramComment_mediaId_accountId_idx" ON "InstagramComment"("mediaId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramComment_accountId_providerId_key" ON "InstagramComment"("accountId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramComment_id_accountId_key" ON "InstagramComment"("id", "accountId");

-- CreateIndex
CREATE INDEX "WebhookEvent_state_nextAttemptAt_idx" ON "WebhookEvent"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_state_leaseExpiresAt_idx" ON "WebhookEvent"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_accountId_providerCommentId_key" ON "WebhookEvent"("provider", "accountId", "providerCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_eventId_key" ON "OutboxMessage"("eventId");

-- CreateIndex
CREATE INDEX "OutboxMessage_state_nextAttemptAt_idx" ON "OutboxMessage"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_state_leaseExpiresAt_idx" ON "OutboxMessage"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingExecution_eventId_key" ON "ProcessingExecution"("eventId");

-- CreateIndex
CREATE INDEX "EventTransition_eventId_createdAt_idx" ON "EventTransition"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstagramMedia" ADD CONSTRAINT "InstagramMedia_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramComment" ADD CONSTRAINT "InstagramComment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramComment" ADD CONSTRAINT "InstagramComment_mediaId_accountId_fkey" FOREIGN KEY ("mediaId", "accountId") REFERENCES "InstagramMedia"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "InstagramAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_commentId_accountId_fkey" FOREIGN KEY ("commentId", "accountId") REFERENCES "InstagramComment"("id", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingExecution" ADD CONSTRAINT "ProcessingExecution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTransition" ADD CONSTRAINT "EventTransition_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Enforce lease invariants and nonnegative counters independently of application code.
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_attempts_nonnegative" CHECK (attempts >= 0);
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_attempts_nonnegative" CHECK (attempts >= 0);
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_processing_lease" CHECK (
  (state = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
  OR (state <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
);
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_dispatch_lease" CHECK (
  (state = 'LEASED' AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
  OR (state <> 'LEASED' AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
);
