-- Historical rows deliberately remain unknown; no authorization is inferred.
ALTER TABLE "AutomationRule" ADD COLUMN "activatedAt" TIMESTAMPTZ(3);
ALTER TABLE "InstagramComment" ADD COLUMN "providerCreatedAt" TIMESTAMPTZ(3);
