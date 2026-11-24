CREATE TYPE "CommentSource" AS ENUM ('WEBHOOK', 'MANUAL_GET');
ALTER TABLE "WebhookEvent" ADD COLUMN "source" "CommentSource" NOT NULL DEFAULT 'WEBHOOK';
ALTER TABLE "WebhookEvent" ALTER COLUMN "notificationTime" DROP NOT NULL;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "manual_get_no_notification_time" CHECK (
  ("source" = 'WEBHOOK' AND "notificationTime" IS NOT NULL) OR
  ("source" = 'MANUAL_GET' AND "notificationTime" IS NULL)
);
