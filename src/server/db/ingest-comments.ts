import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { InstagramCommentEvent } from "@/modules/webhooks/comment-events";
import { commentEncryptionContext, encryptCommentText } from "./encryption";

export async function persistComments(
  database: PrismaClient,
  events: InstagramCommentEvent[],
  encryptionKey: string,
) {
  // Stable lock order prevents deadlocks between overlapping batches. One transaction
  // accepts the entire supported batch, including its outbox records.
  const uniqueEvents = [
    ...new Map(
      events.map((event) => [`${event.accountId}:${event.commentId}`, event]),
    ).values(),
  ].sort((a, b) =>
    `${a.accountId}:${a.commentId}`.localeCompare(
      `${b.accountId}:${b.commentId}`,
    ),
  );
  await database.$transaction(
    async (tx) => {
      for (const accountId of [
        ...new Set(uniqueEvents.map((event) => event.accountId)),
      ].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`instagram:${accountId}`}, 0))`;
      }
      for (const event of uniqueEvents) {
        const account = await tx.instagramAccount.upsert({
          where: {
            provider_providerId: {
              provider: "INSTAGRAM",
              providerId: event.accountId,
            },
          },
          create: { providerId: event.accountId },
          update: {},
        });
        const media = await tx.instagramMedia.upsert({
          where: {
            accountId_providerId: {
              accountId: account.id,
              providerId: event.mediaId,
            },
          },
          create: { accountId: account.id, providerId: event.mediaId },
          update: {},
        });
        const comment = await tx.instagramComment.upsert({
          where: {
            accountId_providerId: {
              accountId: account.id,
              providerId: event.commentId,
            },
          },
          create: {
            accountId: account.id,
            mediaId: media.id,
            providerId: event.commentId,
            textCiphertext:
              event.text === undefined
                ? null
                : encryptCommentText(
                    event.text,
                    encryptionKey,
                    commentEncryptionContext(event.accountId, event.commentId),
                  ),
          },
          update: {},
        });
        if (comment.mediaId !== media.id)
          throw new Error("Comment identity conflict");
        const receipt = await tx.webhookEvent.upsert({
          where: {
            provider_accountId_providerCommentId: {
              provider: "INSTAGRAM",
              accountId: account.id,
              providerCommentId: event.commentId,
            },
          },
          create: {
            accountId: account.id,
            commentId: comment.id,
            providerCommentId: event.commentId,
            source: "WEBHOOK",
            notificationTime: BigInt(event.notificationTime),
          },
          update: {},
        });
        await tx.outboxMessage.upsert({
          where: { eventId: receipt.id },
          create: { eventId: receipt.id },
          update: {},
        });
        // Exactly one initial history record; unique receipt creation is detected by history existence.
        if (
          !(await tx.eventTransition.findFirst({
            where: { eventId: receipt.id },
          }))
        ) {
          await tx.eventTransition.create({
            data: { eventId: receipt.id, state: "RECEIVED" },
          });
        }
      }
    },
    { timeout: 10000, maxWait: 3000 },
  );
}
