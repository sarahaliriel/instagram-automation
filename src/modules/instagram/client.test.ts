import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstagramClient, MetaApiError } from "./client";

const options = {
  apiVersion: "v27.0" as const,
  accountId: "100000000000001",
  credential: {
    kind: "business_integration_system_user" as const,
    accessToken: "synthetic-test-access-token",
    configId: "500000000000001",
    clientBusinessId: "600000000000001",
  },
};
const response = (body: unknown, status = 200) =>
  Response.json(body, { status });
afterEach(() => vi.useRealTimers());

describe("typed Unified Login client", () => {
  it("sends credentials in the header only to the fixed official versioned host", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [{ id: options.accountId, username: "synthetic_user_3" }],
      }),
    );
    const client = createInstagramClient(options, fetcher);
    expect(await client.getAccount()).toEqual({
      id: options.accountId,
      username: "synthetic_user_3",
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?fields=id%2Cusername",
    );
    expect(String(url)).not.toContain(options.credential.accessToken);
    expect(init!.headers).toMatchObject({
      Authorization: `Bearer ${options.credential.accessToken}`,
    });
    expect(init!.redirect).toBe("error");
    expect(init!.cache).toBe("no-store");
    expect(JSON.stringify(client)).not.toContain(
      options.credential.accessToken,
    );
  });
  it("selects only the allowlisted assigned Instagram account", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          data: [
            { id: options.accountId, username: "synthetic_user_3" },
            { id: "888", username: "synthetic_user_4" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({ data: [{ id: "999", username: "synthetic_user_3" }] }),
      );
    const client = createInstagramClient(options, fetcher);
    expect((await client.getAccount()).id).toBe(options.accountId);
    await expect(client.getAccount()).rejects.toMatchObject({
      kind: "authentication",
    });
  });
  it("reads the client business ID without treating the system user as Instagram", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          id: "700000000000001",
          client_business_id: options.credential.clientBusinessId,
          extra: "discard",
        }),
      )
      .mockResolvedValueOnce(
        response({ id: "700000000000001", client_business_id: "999" }),
      );
    const client = createInstagramClient(options, fetcher);
    expect(await client.getClientBusiness()).toEqual({
      id: "700000000000001",
      client_business_id: options.credential.clientBusinessId,
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      "https://graph.facebook.com/v27.0/me?fields=client_business_id",
    );
    await expect(client.getClientBusiness()).rejects.toMatchObject({
      kind: "authentication",
    });
  });
  it.each([
    { id: options.accountId, username: "synthetic_user_2" },
    { data: [{ user_id: options.accountId, username: "synthetic_user_1" }] },
    { data: [] },
    {
      data: [
        { id: options.accountId, username: "synthetic_user_5" },
        { id: options.accountId, username: "synthetic_user_6" },
      ],
    },
  ])("rejects legacy, absent and ambiguous assigned accounts", async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    await expect(
      createInstagramClient(options, fetcher).getAccount(),
    ).rejects.toBeInstanceOf(MetaApiError);
  });
  it("fails closed when the account is absent on the first page without following upstream URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [],
        paging: { next: "https://untrusted.example/?access_token=secret" },
      }),
    );
    await expect(
      createInstagramClient(options, fetcher).getAccount(),
    ).rejects.toMatchObject({ kind: "authentication" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses explicit Instagram identity for media and rejects legacy token kinds before I/O", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ data: [] }));
    await createInstagramClient(options, fetcher).listMedia();
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      `https://graph.facebook.com/v27.0/${options.accountId}/media`,
    );
    fetcher.mockClear();
    expect(() =>
      createInstagramClient(
        {
          ...options,
          credential: {
            ...options.credential,
            kind: "instagram_user" as "business_integration_system_user",
          },
        },
        fetcher,
      ),
    ).toThrow(MetaApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns only validated media IDs and never follows token-bearing paging URLs", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [{ id: "123", private_data: "omitted" }],
        paging: { next: "https://untrusted.example/?access_token=secret" },
      }),
    );
    expect(await createInstagramClient(options, fetcher).listMedia()).toEqual({
      data: [{ id: "123" }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reads a bounded, typed media page for the dashboard without following paging", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          {
            id: "123",
            media_type: "IMAGE",
            caption: "Uma publicação",
            media_url: "https://cdn.example/image.jpg",
            permalink: "https://www.instagram.com/p/example/",
            timestamp: "2026-11-20T10:00:00+0000",
            ignored: "private",
          },
        ],
        paging: { next: "https://untrusted.example/?access_token=secret" },
      }),
    );
    await expect(
      createInstagramClient(options, fetcher).listDashboardMedia(),
    ).resolves.toEqual({
      data: [
        {
          id: "123",
          media_type: "IMAGE",
          caption: "Uma publicação",
          media_url: "https://cdn.example/image.jpg",
          permalink: "https://www.instagram.com/p/example/",
          timestamp: "2026-11-20T10:00:00+0000",
        },
      ],
    });
    expect(String(fetcher.mock.calls[0]![0])).toContain("limit=25");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("subscribes only comments through the Instagram account edge when explicitly invoked", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ success: true }));
    expect(
      await createInstagramClient(options, fetcher).subscribeComments(),
    ).toEqual({ success: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://graph.facebook.com/v27.0/${options.accountId}/subscribed_apps`,
    );
    expect(init!.method).toBe("POST");
    expect(String(init!.body)).toBe("subscribed_fields=comments");
  });
  it.each([
    [400, 190, "authentication"],
    [403, 10, "permission"],
    [429, 4, "rate_limit"],
    [503, 2, "temporary"],
    [400, 100, "rejected"],
    [400, 80002, "rate_limit"],
    [400, 299, "permission"],
  ])(
    "classifies HTTP %i / code %i without leaking upstream error strings",
    async (status, code, kind) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        response(
          {
            error: {
              code,
              error_subcode: 1234,
              message: options.credential.accessToken,
              error_user_msg: "private text",
              fbtrace_id: "untrusted",
            },
          },
          status as number,
        ),
      );
      try {
        await createInstagramClient(options, fetcher).listMedia();
        expect.fail("Expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(MetaApiError);
        expect(error).toMatchObject({
          kind,
          metaCode: code,
          metaSubcode: 1234,
        });
        expect(String(error)).not.toContain(options.credential.accessToken);
        expect(JSON.stringify(error)).not.toContain("private text");
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    },
  );
  it("classifies a transient API failure without automatically retrying", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ error: { code: 2, is_transient: true } }, 400),
      );
    await expect(
      createInstagramClient(options, fetcher).listMedia(),
    ).rejects.toMatchObject({ kind: "temporary" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ data: [{ id: 123 }] }, { wrong: true }, { data: [], error: {} }])(
    "rejects unexpected response shapes",
    async (body) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(body));
      await expect(
        createInstagramClient(options, fetcher).getAccount(),
      ).rejects.toBeInstanceOf(MetaApiError);
    },
  );
  it("rejects malformed and oversized responses without leaking bodies", async () => {
    for (const body of ["invalid-json", "x".repeat(1024 * 1024 + 1)]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(body));
      await expect(
        createInstagramClient(options, fetcher).listMedia(),
      ).rejects.toMatchObject({ kind: "invalid_response" });
    }
  });
  it("redacts transport errors and treats a lost write response as an unknown outcome", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error(`URL with token ${options.credential.accessToken}`),
      );
    try {
      await createInstagramClient(options, fetcher).subscribeComments();
    } catch (error) {
      expect(error).toMatchObject({ kind: "network", outcome: "unknown" });
      expect(String(error)).not.toContain(options.credential.accessToken);
      expect(error).not.toHaveProperty("cause");
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("aborts timed-out requests without retrying or retaining secrets", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error(options.credential.accessToken)),
            { once: true },
          );
        }),
    );
    const pending = createInstagramClient(
      { ...options, timeoutMs: 10 },
      fetcher,
    ).subscribeComments();
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "timeout",
      outcome: "unknown",
    });
    await vi.advanceTimersByTimeAsync(11);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects unreviewed versions and path injection before network access", () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() =>
      createInstagramClient(
        { ...options, apiVersion: "v999.0" as "v27.0" },
        fetcher,
      ),
    ).toThrow(MetaApiError);
    expect(() =>
      createInstagramClient({ ...options, accountId: "../messages" }, fetcher),
    ).toThrow(MetaApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
