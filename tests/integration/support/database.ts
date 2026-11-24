import type { PrismaClient } from "@/generated/prisma/client";

type IsolatedDatabaseOptions = {
  rightsTest?: boolean;
};

type ResetOptions = {
  includeDataRights?: boolean;
};

export function requireIsolatedTestDatabaseUrl(
  options: IsolatedDatabaseOptions = {},
): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("An isolated local TEST_DATABASE_URL is required");

  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  const validName = options.rightsTest
    ? parsed.pathname === "/instagram_rights_test"
    : /^\/[a-z0-9_]+_test$/.test(parsed.pathname);
  if (!loopback || !validName)
    throw new Error("An isolated local TEST_DATABASE_URL is required");

  return url;
}

export async function resetIntegrationFixtures(
  db: PrismaClient,
  options: ResetOptions = {},
) {
  const fallbackAttempts = db.messageAttempt.deleteMany({
    where: { action: { kind: "PUBLIC_FALLBACK" } },
  });
  const fallbackActions = db.deliveryAction.deleteMany({
    where: { kind: "PUBLIC_FALLBACK" },
  });
  const common = [
    fallbackAttempts,
    fallbackActions,
    db.messageAttempt.deleteMany(),
    db.deliveryAction.deleteMany(),
  ];
  const graph = [
    db.automationExecution.deleteMany(),
    db.eventTransition.deleteMany(),
    db.outboxMessage.deleteMany(),
    db.webhookEvent.deleteMany(),
    db.automationKeyword.deleteMany(),
    db.automationRule.deleteMany(),
    db.instagramComment.deleteMany(),
    db.instagramMedia.deleteMany(),
    db.instagramAccount.deleteMany(),
  ];

  // Data-rights fixtures retain their original execution-before-transition order.
  const operations = options.includeDataRights
    ? [
        db.dataRightsErasure.deleteMany(),
        ...common,
        graph[0]!,
        graph[1]!,
        ...graph.slice(2),
      ]
    : [...common, graph[1]!, graph[0]!, ...graph.slice(2)];
  await db.$transaction(operations);
}
