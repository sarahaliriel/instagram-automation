"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { automationDraftSchema } from "@/modules/automations/rule-schema";
import { getAuthorizedInstagramReadClient } from "@/modules/instagram/authorized-client";
import { getInstagramSettings } from "@/modules/instagram/settings";
import { isAuthorizedAdminMutation } from "@/modules/auth/admin-mutation";
import { parseAdminCredentials } from "@/modules/auth/admin-auth";
import { getDatabase } from "@/server/db/client";
import { getPersistenceSettings } from "@/server/db/settings";
import {
  archiveAutomationRule,
  AutomationDraftError,
  createAutomationDraft,
  updateAutomationDraft,
} from "@/server/db/automation-drafts";
import {
  activateAutomationRule,
  deactivateAutomationRule,
  readAutomationDetail,
  reviewAutomationRule,
} from "@/server/db/automation-lifecycle";
import type { AutomationActionState } from "./action-state";

async function requireAuthorizedMutation() {
  const requestHeaders = await headers();
  const authorized = await isAuthorizedAdminMutation(
    {
      authorization: requestHeaders.get("authorization"),
      origin: requestHeaders.get("origin"),
      host: requestHeaders.get("host"),
    },
    parseAdminCredentials(process.env),
    process.env.APP_URL,
  );
  if (!authorized) throw new AutomationDraftError("NOT_FOUND");
}

function parseForm(formData: FormData) {
  return automationDraftSchema.safeParse({
    name: formData.get("name"),
    mediaProviderId: formData.get("mediaProviderId"),
    strategy: formData.get("strategy"),
    keyword: formData.get("keyword"),
    privateMessageTemplate: formData.get("privateMessageTemplate"),
  });
}

async function verifyOwnership(mediaProviderId: string) {
  const settings = getInstagramSettings();
  if (!settings.INSTAGRAM_ACCOUNT_ID)
    throw new AutomationDraftError("ACCOUNT_NOT_FOUND");
  const client = getAuthorizedInstagramReadClient();
  const [account, media] = await Promise.all([
    client.getAccount(),
    client.listDashboardMedia(),
  ]);
  if (account.id !== settings.INSTAGRAM_ACCOUNT_ID)
    throw new AutomationDraftError("ACCOUNT_NOT_FOUND");
  const matches = media.data.filter((item) => item.id === mediaProviderId);
  if (matches.length !== 1) throw new AutomationDraftError("MEDIA_NOT_OWNED");

  return { accountProviderId: account.id, mediaProviderId } as const;
}

async function persistVerifiedOwnership(
  ownership: Awaited<ReturnType<typeof verifyOwnership>>,
) {
  // Persist only canonical IDs already verified through the bounded GET client.
  const database = getDatabase();
  const localAccount = await database.instagramAccount.upsert({
    where: {
      provider_providerId: {
        provider: "INSTAGRAM",
        providerId: ownership.accountProviderId,
      },
    },
    create: {
      provider: "INSTAGRAM",
      providerId: ownership.accountProviderId,
    },
    update: {},
    select: { id: true },
  });
  await database.instagramMedia.upsert({
    where: {
      accountId_providerId: {
        accountId: localAccount.id,
        providerId: ownership.mediaProviderId,
      },
    },
    create: {
      accountId: localAccount.id,
      providerId: ownership.mediaProviderId,
    },
    update: {},
  });
  return ownership;
}

function actionError(error: unknown): AutomationActionState {
  if (error instanceof AutomationDraftError) {
    if (error.code === "CONFLICT")
      return {
        status: "conflict",
        message:
          "Esta automação foi alterada noutra sessão. Recarregue a página antes de continuar.",
      };
    if (error.code === "NOT_EDITABLE")
      return {
        status: "error",
        message:
          "Esta regra já não é um rascunho editável ou já produziu intenções persistidas.",
      };
    if (error.code === "MEDIA_NOT_OWNED")
      return {
        status: "error",
        message: "A publicação já não pertence à conta Instagram autorizada.",
      };
    if (error.code === "REVIEW_REQUIRED")
      return {
        status: "conflict",
        message: "A revisão mudou. Reveja novamente antes de confirmar.",
      };
    if (error.code === "DELIVERY_IN_FLIGHT")
      return {
        status: "error",
        message:
          "Existe uma tentativa de envio em curso. A desativação foi bloqueada sem cancelar histórico.",
      };
    if (error.code === "NOT_ACTIVATABLE" || error.code === "NOT_DEACTIVATABLE")
      return {
        status: "error",
        message: "O estado atual da regra não permite esta operação.",
      };
  }
  return {
    status: "error",
    message:
      "Não foi possível guardar a automação. Nenhuma alteração foi aplicada.",
  };
}

export async function createAutomationAction(
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  try {
    await requireAuthorizedMutation();
    const parsed = parseForm(formData);
    if (!parsed.success)
      return {
        status: "error",
        message: "Reveja os campos assinalados.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    const settings = getPersistenceSettings();
    if (!settings.EVENT_ENCRYPTION_KEY)
      throw new AutomationDraftError("INVALID_INPUT");
    const ownership = await persistVerifiedOwnership(
      await verifyOwnership(parsed.data.mediaProviderId),
    );
    const created = await createAutomationDraft(
      getDatabase(),
      parsed.data,
      settings.EVENT_ENCRYPTION_KEY,
      ownership,
    );
    revalidatePath("/dashboard/automations");
    return {
      status: "success",
      message: "Rascunho criado. Nenhuma automação foi ativada.",
      id: created.id,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function updateAutomationAction(
  ruleId: string,
  expectedRevision: number,
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  try {
    await requireAuthorizedMutation();
    if (
      !z.uuid().safeParse(ruleId).success ||
      !Number.isSafeInteger(expectedRevision)
    )
      throw new AutomationDraftError("INVALID_INPUT");
    const parsed = parseForm(formData);
    if (!parsed.success)
      return {
        status: "error",
        message: "Reveja os campos assinalados.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    const settings = getPersistenceSettings();
    if (!settings.EVENT_ENCRYPTION_KEY)
      throw new AutomationDraftError("INVALID_INPUT");
    const ownership = await persistVerifiedOwnership(
      await verifyOwnership(parsed.data.mediaProviderId),
    );
    await updateAutomationDraft(
      getDatabase(),
      ruleId,
      expectedRevision,
      parsed.data,
      settings.EVENT_ENCRYPTION_KEY,
      ownership,
    );
    revalidatePath("/dashboard/automations");
    revalidatePath(`/dashboard/automations/${ruleId}`);
    return {
      status: "success",
      message: "Rascunho atualizado. Continua inativo.",
      id: ruleId,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function reviewAutomationAction(
  ruleId: string,
  expectedRevision: number,
  previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  void previous;
  void formData;
  try {
    await requireAuthorizedMutation();
    if (
      !z.uuid().safeParse(ruleId).success ||
      !Number.isSafeInteger(expectedRevision)
    )
      throw new AutomationDraftError("INVALID_INPUT");
    const persistence = getPersistenceSettings();
    const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
    if (!persistence.EVENT_ENCRYPTION_KEY || !accountProviderId)
      throw new AutomationDraftError("INVALID_INPUT");
    const review = await reviewAutomationRule(
      getDatabase(),
      ruleId,
      persistence.EVENT_ENCRYPTION_KEY,
      accountProviderId,
    );
    if (review.revision !== expectedRevision)
      throw new AutomationDraftError("CONFLICT");
    if (!review.mediaProviderId)
      throw new AutomationDraftError("MEDIA_NOT_OWNED");
    await verifyOwnership(review.mediaProviderId);
    return {
      status: "success",
      message: "Revisão atual confirmada através da publicação autorizada.",
      id: ruleId,
      review,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function activateAutomationAction(
  ruleId: string,
  expectedRevision: number,
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  try {
    await requireAuthorizedMutation();
    const reviewDigest = formData.get("reviewDigest");
    if (
      !z.uuid().safeParse(ruleId).success ||
      !Number.isSafeInteger(expectedRevision) ||
      formData.get("confirmation") !== "ATIVAR" ||
      typeof reviewDigest !== "string"
    )
      throw new AutomationDraftError("INVALID_INPUT");
    const persistence = getPersistenceSettings();
    const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
    if (!persistence.EVENT_ENCRYPTION_KEY || !accountProviderId)
      throw new AutomationDraftError("INVALID_INPUT");
    const detail = await readAutomationDetail(
      getDatabase(),
      ruleId,
      accountProviderId,
    );
    if (!detail.mediaProviderId)
      throw new AutomationDraftError("MEDIA_NOT_OWNED");
    const ownership = await verifyOwnership(detail.mediaProviderId);
    const activated = await activateAutomationRule(
      getDatabase(),
      ruleId,
      expectedRevision,
      reviewDigest,
      persistence.EVENT_ENCRYPTION_KEY,
      ownership,
    );
    revalidatePath("/dashboard/automations");
    revalidatePath(`/dashboard/automations/${ruleId}`);
    return {
      status: "success",
      message:
        "Regra ativada no PostgreSQL. Webhooks, jobs e delivery continuam desativados.",
      id: activated.id,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function deactivateAutomationAction(
  ruleId: string,
  expectedRevision: number,
  _previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  try {
    await requireAuthorizedMutation();
    const reviewDigest = formData.get("reviewDigest");
    if (
      !z.uuid().safeParse(ruleId).success ||
      !Number.isSafeInteger(expectedRevision) ||
      formData.get("confirmation") !== "DESATIVAR" ||
      typeof reviewDigest !== "string"
    )
      throw new AutomationDraftError("INVALID_INPUT");
    const persistence = getPersistenceSettings();
    const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
    if (!persistence.EVENT_ENCRYPTION_KEY || !accountProviderId)
      throw new AutomationDraftError("INVALID_INPUT");
    const deactivated = await deactivateAutomationRule(
      getDatabase(),
      ruleId,
      expectedRevision,
      reviewDigest,
      persistence.EVENT_ENCRYPTION_KEY,
      accountProviderId,
    );
    revalidatePath("/dashboard/automations");
    revalidatePath(`/dashboard/automations/${ruleId}`);
    return {
      status: "success",
      message:
        "Regra desativada. Intenções e tentativas existentes foram preservadas.",
      id: deactivated.id,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function archiveAutomationAction(
  ruleId: string,
  expectedRevision: number,
  previous: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  void previous;
  void formData;
  try {
    await requireAuthorizedMutation();
    if (
      !z.uuid().safeParse(ruleId).success ||
      !Number.isSafeInteger(expectedRevision)
    )
      throw new AutomationDraftError("INVALID_INPUT");
    const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
    if (!accountProviderId) throw new AutomationDraftError("ACCOUNT_NOT_FOUND");
    await archiveAutomationRule(
      getDatabase(),
      ruleId,
      expectedRevision,
      accountProviderId,
    );
    revalidatePath("/dashboard/automations");
    revalidatePath(`/dashboard/automations/${ruleId}`);
    return {
      status: "success",
      message: "Automação arquivada. O histórico foi preservado.",
      id: ruleId,
    };
  } catch (error) {
    return actionError(error);
  }
}
