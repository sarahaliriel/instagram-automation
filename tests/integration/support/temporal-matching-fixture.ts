import type { PrismaClient } from "@/generated/prisma/client";

// Synthetic evidence solely for tests whose subject assumes an already-active
// rule and a later comment. Missing-evidence and lifecycle tests do not use it.
export const SYNTHETIC_ACTIVATION = new Date("2020-01-01T00:00:00.000Z");
export const SYNTHETIC_COMMENT_CREATION = new Date("2020-01-02T00:00:00.000Z");

export async function recordSyntheticCommentCreation(
  db: PrismaClient,
  commentId: string,
) {
  await db.instagramComment.update({
    where: { id: commentId },
    data: { providerCreatedAt: SYNTHETIC_COMMENT_CREATION },
  });
}

export async function recordSyntheticRuleActivation(
  db: PrismaClient,
  ruleId: string,
) {
  return db.automationRule.update({
    where: { id: ruleId },
    data: { activatedAt: SYNTHETIC_ACTIVATION },
    include: { keywords: true },
  });
}
