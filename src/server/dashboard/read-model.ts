import "server-only";
import { getDatabase } from "@/server/db/client";
import { getAuthorizedInstagramReadClient } from "@/modules/instagram/authorized-client";
import { getInstagramSettings } from "@/modules/instagram/settings";
import { presentDeliveryState } from "@/modules/activity/presentation";
import { getPersistenceSettings } from "@/server/db/settings";
import { getDeliverySettings } from "@/server/delivery/settings";
import { readPrivateAutomationDraft } from "@/server/db/automation-drafts";
import { readAutomationDetail } from "@/server/db/automation-lifecycle";

export type DataAvailability = "available" | "unconfigured" | "unavailable";

export type DashboardSummary = Readonly<{
  availability: DataAvailability;
  stats: Readonly<{
    posts: number;
    rules: number;
    events: number;
    deliveryActions: number;
  }> | null;
  account: Readonly<{
    configured: boolean;
    mode: "disabled" | "development" | "read_only";
    username: string | null;
  }>;
  recentActivity: readonly ActivityItem[];
  automation: Readonly<{ total: number; enabled: number }> | null;
  controls: Readonly<{
    adminMetaReads: boolean;
    webhooks: boolean;
    jobs: boolean;
    delivery: boolean;
    publicFallback: boolean;
  }>;
}>;

export type ActivityItem = Readonly<{
  id: string;
  state: string;
  label: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "critical";
  kind: "PRIVATE_REPLY" | "PUBLIC_FALLBACK";
  mode: "MOCK" | "CONTROLLED_TEST";
  attempts: number;
  createdAt: Date;
}>;

export type AutomationItem = Readonly<{
  id: string;
  name: string;
  enabled: boolean;
  strategy: "EXACT" | "WHOLE_WORD";
  scope: "GLOBAL" | "MEDIA";
  priority: number;
  keywords: readonly string[];
  updatedAt: Date;
  revision: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  executionCount: number;
}>;

export type DashboardPost = Readonly<{
  id: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  caption: string | null;
  imageUrl: string | null;
  permalink: string | null;
  timestamp: Date;
}>;

function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

async function readActivity(limit = 12): Promise<ActivityItem[]> {
  const database = getDatabase();
  const actions = await database.deliveryAction.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      state: true,
      kind: true,
      mode: true,
      attempts: true,
      createdAt: true,
    },
  });
  return actions.map((action) => ({
    ...action,
    ...presentDeliveryState(action.state),
  }));
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  let settings: ReturnType<typeof getInstagramSettings> | null = null;
  try {
    settings = getInstagramSettings();
  } catch {
    // Invalid or partial configuration is presented as disconnected, never exposed.
  }
  const account = {
    configured: Boolean(
      (settings?.INSTAGRAM_ADMIN_READ_MODE === "development" ||
        settings?.INSTAGRAM_INTEGRATION_MODE === "development") &&
      settings.META_SYSTEM_USER_ACCESS_TOKEN &&
      settings.INSTAGRAM_ACCOUNT_ID,
    ),
    mode:
      settings?.INSTAGRAM_ADMIN_READ_MODE === "development"
        ? ("read_only" as const)
        : (settings?.INSTAGRAM_INTEGRATION_MODE ?? ("disabled" as const)),
    username: null as string | null,
  };
  let jobs = false;
  let delivery = false;
  let publicFallback = false;
  try {
    jobs = getPersistenceSettings().JOBS_MODE === "development";
  } catch {
    // Invalid operational configuration remains fail-closed in the UI.
  }
  try {
    const deliverySettings = getDeliverySettings();
    delivery = deliverySettings.INSTAGRAM_DELIVERY_MODE !== "disabled";
    publicFallback = deliverySettings.INSTAGRAM_PUBLIC_FALLBACK_ENABLED === "1";
  } catch {
    // Invalid operational configuration remains fail-closed in the UI.
  }
  const controls = {
    adminMetaReads: account.configured && account.mode === "read_only",
    webhooks: settings?.INSTAGRAM_INTEGRATION_MODE === "development",
    jobs,
    delivery,
    publicFallback,
  };

  if (account.configured) {
    try {
      account.username = (
        await getAuthorizedInstagramReadClient().getAccount()
      ).username;
    } catch {
      // Connection errors remain sanitized and do not block database reads.
    }
  }
  if (!databaseConfigured())
    return {
      availability: "unconfigured",
      stats: null,
      account,
      recentActivity: [],
      automation: null,
      controls,
    };

  try {
    const database = getDatabase();
    const [posts, rules, events, deliveryActions, enabled, recentActivity] =
      await Promise.all([
        database.instagramMedia.count(),
        database.automationRule.count(),
        database.webhookEvent.count(),
        database.deliveryAction.count(),
        database.automationRule.count({ where: { enabled: true } }),
        readActivity(6),
      ]);
    return {
      availability: "available",
      stats: { posts, rules, events, deliveryActions },
      account,
      recentActivity,
      automation: { total: rules, enabled },
      controls,
    };
  } catch {
    return {
      availability: "unavailable",
      stats: null,
      account,
      recentActivity: [],
      automation: null,
      controls,
    };
  }
}

export async function getAutomations(
  filters: {
    query?: string;
    status?: "ALL" | "DRAFT" | "ACTIVE" | "ARCHIVED";
  } = {},
): Promise<{
  availability: DataAvailability;
  items: AutomationItem[];
}> {
  if (!databaseConfigured()) return { availability: "unconfigured", items: [] };
  try {
    const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
    if (!accountProviderId) return { availability: "unconfigured", items: [] };
    const query = filters.query?.trim().slice(0, 120);
    const status = filters.status ?? "ALL";
    const rules = await getDatabase().automationRule.findMany({
      where: {
        account: { providerId: accountProviderId },
        ...(status === "DRAFT"
          ? { enabled: false, archivedAt: null }
          : status === "ACTIVE"
            ? { enabled: true, archivedAt: null }
            : status === "ARCHIVED"
              ? { archivedAt: { not: null } }
              : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                {
                  keywords: {
                    some: {
                      originalKeyword: {
                        contains: query,
                        mode: "insensitive",
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        name: true,
        enabled: true,
        strategy: true,
        scope: true,
        priority: true,
        updatedAt: true,
        archivedAt: true,
        revision: true,
        keywords: { select: { originalKeyword: true } },
        _count: { select: { executions: true } },
      },
    });
    return {
      availability: "available",
      items: rules.map(({ keywords, _count, ...rule }) => ({
        ...rule,
        keywords: keywords.map((keyword) => keyword.originalKeyword),
        executionCount: _count.executions,
        status: rule.archivedAt
          ? ("ARCHIVED" as const)
          : rule.enabled
            ? ("ACTIVE" as const)
            : ("DRAFT" as const),
      })),
    };
  } catch {
    return { availability: "unavailable", items: [] };
  }
}

export async function getAutomationFormOptions(): Promise<{
  availability: DataAvailability;
  account: { id: string; username: string } | null;
  posts: Array<{
    id: string;
    caption: string | null;
    timestamp: Date;
  }>;
}> {
  try {
    const client = getAuthorizedInstagramReadClient();
    const [account, media] = await Promise.all([
      client.getAccount(),
      client.listDashboardMedia(),
    ]);
    return {
      availability: "available",
      account,
      posts: media.data.map((item) => ({
        id: item.id,
        caption: item.caption ?? null,
        timestamp: new Date(item.timestamp),
      })),
    };
  } catch {
    const configured =
      (process.env.INSTAGRAM_ADMIN_READ_MODE === "development" ||
        process.env.INSTAGRAM_INTEGRATION_MODE === "development") &&
      Boolean(process.env.META_SYSTEM_USER_ACCESS_TOKEN);
    return {
      availability: configured ? "unavailable" : "unconfigured",
      account: null,
      posts: [],
    };
  }
}

export async function getPrivateAutomation(ruleId: string) {
  const persistence = getPersistenceSettings();
  const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
  if (!persistence.EVENT_ENCRYPTION_KEY || !accountProviderId) return null;
  try {
    return await readPrivateAutomationDraft(
      getDatabase(),
      ruleId,
      persistence.EVENT_ENCRYPTION_KEY,
      accountProviderId,
    );
  } catch {
    return null;
  }
}

export async function getAutomationDetail(ruleId: string) {
  const accountProviderId = getInstagramSettings().INSTAGRAM_ACCOUNT_ID;
  if (!accountProviderId) return null;
  try {
    return await readAutomationDetail(getDatabase(), ruleId, accountProviderId);
  } catch {
    return null;
  }
}

export async function getActivity(): Promise<{
  availability: DataAvailability;
  items: ActivityItem[];
}> {
  if (!databaseConfigured()) return { availability: "unconfigured", items: [] };
  try {
    return { availability: "available", items: await readActivity(50) };
  } catch {
    return { availability: "unavailable", items: [] };
  }
}

export async function getPosts(): Promise<{
  availability: DataAvailability;
  items: DashboardPost[];
}> {
  try {
    const result =
      await getAuthorizedInstagramReadClient().listDashboardMedia();
    return {
      availability: "available",
      items: result.data.map((media) => ({
        id: media.id,
        mediaType: media.media_type,
        caption: media.caption ?? null,
        imageUrl: media.thumbnail_url ?? media.media_url ?? null,
        permalink: media.permalink ?? null,
        timestamp: new Date(media.timestamp),
      })),
    };
  } catch {
    const configured =
      (process.env.INSTAGRAM_ADMIN_READ_MODE === "development" ||
        process.env.INSTAGRAM_INTEGRATION_MODE === "development") &&
      Boolean(process.env.META_SYSTEM_USER_ACCESS_TOKEN);
    return {
      availability: configured ? "unavailable" : "unconfigured",
      items: [],
    };
  }
}
