import "server-only";
import { createHash, verify } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Scope = { accountProviderId: string; commentProviderId: string };
type Approval = {
  caseId: string;
  digest: string;
  expiresAt: string;
  signature: string;
};

const identifier = /^[0-9]{1,64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denial = () => new Error("Data rights operation denied");

function validateScope(scope: Scope) {
  if (
    !identifier.test(scope.accountProviderId) ||
    !identifier.test(scope.commentProviderId)
  )
    throw denial();
}

async function requireIsolatedDatabase(tx: Prisma.TransactionClient) {
  const configured = process.env.TEST_DATABASE_URL;
  if (!configured) throw denial();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw denial();
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/instagram_rights_test"
  )
    throw denial();
  const rows = await tx.$queryRaw<
    { database: string }[]
  >`SELECT current_database() AS database`;
  const database = rows[0]?.database;
  if (database !== url.pathname.slice(1)) throw denial();
}

async function snapshot(tx: Prisma.TransactionClient, scope: Scope) {
  const account = await tx.instagramAccount.findUnique({
    where: {
      provider_providerId: {
        provider: "INSTAGRAM",
        providerId: scope.accountProviderId,
      },
    },
    select: { id: true },
  });
  if (!account) throw denial();
  // Uses the same account lock as webhook ingestion, so a new event cannot
  // commit between the final snapshot and the deletion transaction.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`instagram:${scope.accountProviderId}`}, 0))`;
  const comment = await tx.instagramComment.findUnique({
    where: {
      accountId_providerId: {
        accountId: account.id,
        providerId: scope.commentProviderId,
      },
    },
    select: {
      id: true,
      accountId: true,
      mediaId: true,
      providerId: true,
      textCiphertext: true,
    },
  });
  if (!comment) throw denial();
  const events = await tx.webhookEvent.findMany({
    where: { commentId: comment.id, accountId: account.id },
    include: {
      outbox: true,
      transitions: { orderBy: { id: "asc" } },
      execution: {
        include: {
          deliveries: {
            orderBy: { id: "asc" },
            include: { messageAttempts: { orderBy: { id: "asc" } } },
          },
        },
      },
    },
  });
  if (
    events.length !== 1 ||
    events[0]?.providerCommentId !== scope.commentProviderId
  )
    throw denial();
  const event = events[0];
  if (
    event.leaseToken ||
    event.outbox?.leaseToken ||
    event.state === "PROCESSING" ||
    event.outbox?.state === "LEASED" ||
    event.execution?.deliveries.some(
      (action) =>
        action.kind === "PUBLIC_FALLBACK" ||
        action.rejectionEvidenceId !== null ||
        action.activeAttemptId ||
        action.leaseExpiresAt ||
        action.state === "SENDING",
    )
  )
    throw denial();
  const ids = {
    account: account.id,
    comment: comment.id,
    event: event.id,
    outbox: event.outbox?.id ?? null,
    execution: event.execution?.id ?? null,
    transitions: event.transitions.map((row) => row.id).sort(),
    actions: (event.execution?.deliveries ?? []).map((row) => row.id).sort(),
    attempts: (event.execution?.deliveries ?? [])
      .flatMap((row) => row.messageAttempts.map((attempt) => attempt.id))
      .sort(),
  };
  const digest = createHash("sha256")
    .update(
      JSON.stringify({ scope, ids, comment, event }, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    )
    .digest("hex");
  return {
    digest,
    ids,
    preview: {
      accountMatched: true,
      commentMatched: true,
      encryptedCommentPresent: comment.textCiphertext !== null,
      encryptedIntentPresent:
        event.execution?.intentCiphertext !== null &&
        event.execution?.intentCiphertext !== undefined,
      encryptedOperationCount: (event.execution?.deliveries ?? []).filter(
        (row) => row.operationIdCiphertext !== null,
      ).length,
      receipts: 1,
      outbox: event.outbox ? 1 : 0,
      executions: event.execution ? 1 : 0,
      transitions: ids.transitions.length,
      actions: ids.actions.length,
      attempts: ids.attempts.length,
      requiresRetentionReview: true,
    },
  };
}

export async function prepareDataRightsErasure(db: PrismaClient, scope: Scope) {
  validateScope(scope);
  return db.$transaction(
    async (tx) => {
      await requireIsolatedDatabase(tx);
      const result = await snapshot(tx, scope);
      return { digest: result.digest, preview: result.preview };
    },
    { timeout: 10000, maxWait: 3000 },
  );
}

export async function executeDataRightsErasure(
  db: PrismaClient,
  scope: Scope,
  approval: Approval,
  reviewerPublicKeyPem: string,
) {
  validateScope(scope);
  const expectedFingerprint = process.env.DATA_RIGHTS_REVIEWER_KEY_SHA256;
  if (
    !expectedFingerprint ||
    !/^[0-9a-f]{64}$/.test(expectedFingerprint) ||
    createHash("sha256").update(reviewerPublicKeyPem).digest("hex") !==
      expectedFingerprint
  )
    throw denial();
  if (
    !uuid.test(approval.caseId) ||
    !/^[0-9a-f]{64}$/.test(approval.digest) ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    Date.parse(approval.expiresAt) <= Date.now() ||
    Date.parse(approval.expiresAt) > Date.now() + 15 * 60_000
  )
    throw denial();
  const signed = Buffer.from(
    `data-rights-erasure:v1\n${approval.caseId}\n${approval.digest}\n${approval.expiresAt}`,
  );
  let valid = false;
  try {
    valid = verify(
      null,
      signed,
      reviewerPublicKeyPem,
      Buffer.from(approval.signature, "base64"),
    );
  } catch {
    throw denial();
  }
  if (!valid) throw denial();
  return db.$transaction(
    async (tx) => {
      await requireIsolatedDatabase(tx);
      const prior = await tx.dataRightsErasure.findUnique({
        where: { caseId: approval.caseId },
      });
      if (prior) {
        if (prior.digest !== approval.digest) throw denial();
        const recreated = await tx.instagramComment.findFirst({
          where: {
            providerId: scope.commentProviderId,
            account: {
              provider: "INSTAGRAM",
              providerId: scope.accountProviderId,
            },
          },
          select: { id: true },
        });
        if (recreated) throw denial();
        return { status: "already_erased" as const, counts: null };
      }
      const current = await snapshot(tx, scope);
      if (current.digest !== approval.digest) throw denial();
      const { ids } = current;
      // Explicit child-first deletion; shared account, media, rules and keywords remain.
      await tx.deliveryAction.updateMany({
        where: { id: { in: ids.actions } },
        data: { rejectionEvidenceId: null },
      });
      const attempts = await tx.messageAttempt.deleteMany({
        where: { id: { in: ids.attempts } },
      });
      const actions = await tx.deliveryAction.deleteMany({
        where: { id: { in: ids.actions } },
      });
      const executions = ids.execution
        ? await tx.automationExecution.deleteMany({
            where: { id: ids.execution },
          })
        : { count: 0 };
      const transitions = await tx.eventTransition.deleteMany({
        where: { id: { in: ids.transitions } },
      });
      const outbox = ids.outbox
        ? await tx.outboxMessage.deleteMany({ where: { id: ids.outbox } })
        : { count: 0 };
      const receipts = await tx.webhookEvent.deleteMany({
        where: { id: ids.event },
      });
      const comments = await tx.instagramComment.deleteMany({
        where: { id: ids.comment, accountId: ids.account },
      });
      if (
        attempts.count !== ids.attempts.length ||
        actions.count !== ids.actions.length ||
        executions.count !== Number(Boolean(ids.execution)) ||
        transitions.count !== ids.transitions.length ||
        outbox.count !== Number(Boolean(ids.outbox)) ||
        receipts.count !== 1 ||
        comments.count !== 1
      )
        throw denial();
      await tx.dataRightsErasure.create({
        data: { caseId: approval.caseId, digest: approval.digest },
      });
      return {
        status: "erased" as const,
        counts: {
          attempts: attempts.count,
          actions: actions.count,
          executions: executions.count,
          transitions: transitions.count,
          outbox: outbox.count,
          receipts: receipts.count,
          comments: comments.count,
        },
      };
    },
    { timeout: 10000, maxWait: 3000 },
  );
}
