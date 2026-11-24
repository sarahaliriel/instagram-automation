import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAutomationActionState } from "./action-state";

const mocks = vi.hoisted(() => ({
  authorized: vi.fn(),
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  getDatabase: vi.fn(),
  getPersistenceSettings: vi.fn(),
  getInstagramSettings: vi.fn(),
  getAccount: vi.fn(),
  listDashboardMedia: vi.fn(),
  reviewAutomationRule: vi.fn(),
  readAutomationDetail: vi.fn(),
  activateAutomationRule: vi.fn(),
  deactivateAutomationRule: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/modules/auth/admin-mutation", () => ({
  isAuthorizedAdminMutation: mocks.authorized,
}));
vi.mock("@/modules/auth/admin-auth", () => ({
  parseAdminCredentials: () => ({ username: "admin", password: "private" }),
}));
vi.mock("@/server/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/db/settings", () => ({
  getPersistenceSettings: mocks.getPersistenceSettings,
}));
vi.mock("@/modules/instagram/settings", () => ({
  getInstagramSettings: mocks.getInstagramSettings,
}));
vi.mock("@/modules/instagram/authorized-client", () => ({
  getAuthorizedInstagramReadClient: () => ({
    getAccount: mocks.getAccount,
    listDashboardMedia: mocks.listDashboardMedia,
  }),
}));
vi.mock("@/server/db/automation-lifecycle", () => ({
  reviewAutomationRule: mocks.reviewAutomationRule,
  readAutomationDetail: mocks.readAutomationDetail,
  activateAutomationRule: mocks.activateAutomationRule,
  deactivateAutomationRule: mocks.deactivateAutomationRule,
}));

import {
  activateAutomationAction,
  deactivateAutomationAction,
  reviewAutomationAction,
} from "./actions";

const id = "10000000-0000-4000-8000-000000000001";
const mediaProviderId = "00000000000000071";
const review = {
  id,
  name: "Guide",
  status: "DRAFT" as const,
  revision: 2,
  strategy: "EXACT" as const,
  scope: "MEDIA" as const,
  priority: 0,
  mediaProviderId,
  keyword: "GUIA",
  privateMessageTemplate: "Private reviewed message",
  executionCount: 0,
  publicFallbackEnabled: false,
  conflicts: [],
  reviewDigest: "a".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorized.mockResolvedValue(true);
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getDatabase.mockReturnValue({});
  mocks.getPersistenceSettings.mockReturnValue({
    EVENT_ENCRYPTION_KEY: "b".repeat(64),
  });
  mocks.getInstagramSettings.mockReturnValue({
    INSTAGRAM_ACCOUNT_ID: "00000000000000072",
  });
  mocks.getAccount.mockResolvedValue({ id: "00000000000000072" });
  mocks.listDashboardMedia.mockResolvedValue({
    data: [{ id: mediaProviderId }],
  });
  mocks.reviewAutomationRule.mockResolvedValue(review);
  mocks.readAutomationDetail.mockResolvedValue(review);
  mocks.activateAutomationRule.mockResolvedValue({
    id,
    revision: 3,
    enabled: true,
  });
  mocks.deactivateAutomationRule.mockResolvedValue({
    id,
    revision: 3,
    enabled: false,
  });
});

describe("automation lifecycle server actions", () => {
  it("fails closed before review when administrator authorization is absent", async () => {
    mocks.authorized.mockResolvedValue(false);
    const result = await reviewAutomationAction(
      id,
      2,
      initialAutomationActionState,
      new FormData(),
    );
    expect(result.status).toBe("error");
    expect(mocks.reviewAutomationRule).not.toHaveBeenCalled();
  });

  it("fails closed when publication ownership cannot be reconfirmed", async () => {
    mocks.listDashboardMedia.mockRejectedValue(new Error("Meta unavailable"));
    const result = await reviewAutomationAction(
      id,
      2,
      initialAutomationActionState,
      new FormData(),
    );
    expect(result).toMatchObject({ status: "error" });
    expect(result.review).toBeUndefined();
  });

  it("returns a bounded explicit review using only authorized read methods", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const result = await reviewAutomationAction(
      id,
      2,
      initialAutomationActionState,
      new FormData(),
    );
    expect(result.review).toMatchObject({ id, revision: 2, mediaProviderId });
    expect(mocks.getAccount).toHaveBeenCalledOnce();
    expect(mocks.listDashboardMedia).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
  });

  it("requires exact confirmation and passes the reviewed digest to activation", async () => {
    const rejected = new FormData();
    rejected.set("confirmation", "activate");
    rejected.set("reviewDigest", review.reviewDigest);
    expect(
      await activateAutomationAction(
        id,
        2,
        initialAutomationActionState,
        rejected,
      ),
    ).toMatchObject({ status: "error" });
    expect(mocks.activateAutomationRule).not.toHaveBeenCalled();

    const accepted = new FormData();
    accepted.set("confirmation", "ATIVAR");
    accepted.set("reviewDigest", review.reviewDigest);
    expect(
      await activateAutomationAction(
        id,
        2,
        initialAutomationActionState,
        accepted,
      ),
    ).toMatchObject({ status: "success", id });
    expect(mocks.activateAutomationRule).toHaveBeenCalledWith(
      {},
      id,
      2,
      review.reviewDigest,
      "b".repeat(64),
      { accountProviderId: "00000000000000072", mediaProviderId },
    );
  });

  it("requires explicit deactivation and never calls activation", async () => {
    const form = new FormData();
    form.set("confirmation", "DESATIVAR");
    form.set("reviewDigest", review.reviewDigest);
    expect(
      await deactivateAutomationAction(
        id,
        2,
        initialAutomationActionState,
        form,
      ),
    ).toMatchObject({ status: "success", id });
    expect(mocks.deactivateAutomationRule).toHaveBeenCalledOnce();
    expect(mocks.activateAutomationRule).not.toHaveBeenCalled();
  });
});
