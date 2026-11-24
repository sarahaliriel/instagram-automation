-- DropForeignKey
ALTER TABLE "WebhookEvent" DROP CONSTRAINT "WebhookEvent_commentId_accountId_fkey";

-- DropIndex
DROP INDEX "InstagramComment_id_accountId_key";

-- CreateIndex
CREATE UNIQUE INDEX "InstagramComment_id_accountId_providerId_key" ON "InstagramComment"("id", "accountId", "providerId");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_commentId_accountId_providerCommentId_fkey" FOREIGN KEY ("commentId", "accountId", "providerCommentId") REFERENCES "InstagramComment"("id", "accountId", "providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

