import "server-only";
import { z } from "zod";
import {
  BodyTooLargeError,
  readLimitedBody,
} from "@/shared/http/read-limited-body";
import { apiVersionSchema } from "./settings-schema";

export type MetaFailureKind =
  | "configuration"
  | "authentication"
  | "permission"
  | "rate_limit"
  | "rejected"
  | "temporary"
  | "timeout"
  | "network"
  | "invalid_response";
export class MetaApiError extends Error {
  constructor(
    public readonly kind: MetaFailureKind,
    public readonly status?: number,
    public readonly metaCode?: number,
    public readonly metaSubcode?: number,
    public readonly outcome:
      "rejected" | "unknown" | "not_requested" = "unknown",
  ) {
    super(`Instagram API request failed (${kind}).`);
    this.name = "MetaApiError";
  }
}
const id = z.string().regex(/^\d{1,64}$/);
const accountSchema = z.object({ id, username: z.string().min(1) });
const assignedAccountsSchema = z.object({ data: z.array(accountSchema) });
const businessSchema = z.object({ id, client_business_id: id });
const mediaSchema = z.object({ data: z.array(z.object({ id })) });
const dashboardMediaSchema = z.object({
  data: z
    .array(
      z.object({
        id,
        media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
        caption: z.string().max(100000).optional(),
        media_url: z.url().optional(),
        thumbnail_url: z.url().optional(),
        permalink: z.url().optional(),
        timestamp: z
          .string()
          .refine((value) => Number.isFinite(Date.parse(value))),
      }),
    )
    .max(25),
});
const failureSchema = z.object({
  error: z.object({
    code: z.number().int().optional(),
    error_subcode: z.number().int().optional(),
    is_transient: z.boolean().optional(),
  }),
});
const optionsSchema = z.object({
  apiVersion: apiVersionSchema,
  accountId: id,
  credential: z
    .object({
      kind: z.literal("business_integration_system_user"),
      accessToken: z.string().min(1).regex(/^\S+$/),
      configId: id,
      clientBusinessId: id,
    })
    .strict(),
  timeoutMs: z.number().int().min(1).max(30000).default(10000),
});
export type InstagramClientOptions = z.input<typeof optionsSchema>;
export type BusinessIntegrationCredential =
  InstagramClientOptions["credential"];

// Closed metadata only: never pass payloads, Zod issues or exception messages.
export type BusinessResponseDiagnostic = {
  validJson: boolean | null;
  bodyType:
    "object" | "array" | "null" | "string" | "number" | "boolean" | "unknown";
  idExists: boolean;
  idIsString: boolean;
  clientBusinessIdExists: boolean;
  clientBusinessIdIsString: boolean;
  parsingFailure: boolean;
  validationFailure: boolean;
  readFailure: boolean;
};

export function createInstagramClient(
  input: InstagramClientOptions,
  fetcher: typeof fetch = fetch,
  observeBusinessResponse?: (diagnostic: BusinessResponseDiagnostic) => void,
) {
  const checked = optionsSchema.safeParse(input);
  if (!checked.success)
    throw new MetaApiError(
      "configuration",
      undefined,
      undefined,
      undefined,
      "not_requested",
    );
  // Closure only: credentials are never enumerable properties on the returned client.
  const options = checked.data;
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    method: "GET" | "POST" = "GET",
    params?: URLSearchParams,
  ): Promise<T> {
    const url = new URL(
      `https://graph.facebook.com/${options.apiVersion}/${path}`,
    );
    if (method === "GET" && params) url.search = params.toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${options.credential.accessToken}`,
          Accept: "application/json",
          ...(method === "POST"
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: method === "POST" ? params : undefined,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const diagnostic: BusinessResponseDiagnostic = {
        validJson: null,
        bodyType: "unknown",
        idExists: false,
        idIsString: false,
        clientBusinessIdExists: false,
        clientBusinessIdIsString: false,
        parsingFailure: false,
        validationFailure: false,
        readFailure: false,
      };
      const observe = () => {
        if (path === "me" && method === "GET")
          observeBusinessResponse?.({ ...diagnostic });
      };
      let bytes: Uint8Array;
      try {
        bytes = await readLimitedBody(response.body, 1024 * 1024);
      } catch (error) {
        diagnostic.readFailure = true;
        observe();
        if (error instanceof BodyTooLargeError)
          throw new MetaApiError("invalid_response", response.status);
        throw error;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        diagnostic.validJson = false;
        diagnostic.parsingFailure = true;
        observe();
        throw new MetaApiError("invalid_response", response.status);
      }
      diagnostic.validJson = true;
      diagnostic.bodyType =
        payload === null
          ? "null"
          : Array.isArray(payload)
            ? "array"
            : (typeof payload as BusinessResponseDiagnostic["bodyType"]);
      if (diagnostic.bodyType === "object") {
        const object = payload as Record<string, unknown>;
        diagnostic.idExists = Object.hasOwn(object, "id");
        diagnostic.idIsString = typeof object.id === "string";
        diagnostic.clientBusinessIdExists = Object.hasOwn(
          object,
          "client_business_id",
        );
        diagnostic.clientBusinessIdIsString =
          typeof object.client_business_id === "string";
      }
      if (!response.ok || failureSchema.safeParse(payload).success) {
        observe();
        const failure = failureSchema.safeParse(payload);
        const code = failure.success ? failure.data.error.code : undefined;
        const subcode = failure.success
          ? failure.data.error.error_subcode
          : undefined;
        const kind: MetaFailureKind =
          response.status === 401 || code === 190
            ? "authentication"
            : response.status === 429 ||
                [4, 17, 32, 613, 80002].includes(code ?? -1)
              ? "rate_limit"
              : response.status >= 500 ||
                  code === 2 ||
                  (failure.success && failure.data.error.is_transient === true)
                ? "temporary"
                : response.status === 403 ||
                    code === 10 ||
                    (code !== undefined && code >= 200 && code <= 299)
                  ? "permission"
                  : "rejected";
        throw new MetaApiError(
          kind,
          response.status,
          code,
          subcode,
          response.status >= 500 ? "unknown" : "rejected",
        );
      }
      const parsed = schema.safeParse(payload);
      diagnostic.validationFailure = !parsed.success;
      observe();
      if (!parsed.success)
        throw new MetaApiError("invalid_response", response.status);
      return parsed.data;
    } catch (error) {
      if (controller.signal.aborted) throw new MetaApiError("timeout");
      if (error instanceof BodyTooLargeError)
        throw new MetaApiError("invalid_response");
      if (error instanceof MetaApiError) throw error;
      // Never preserve fetch errors/causes: they may contain URLs, headers or tokens.
      throw new MetaApiError(controller.signal.aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    async getClientBusiness(
      fields:
        "client_business_id" | "id,client_business_id" = "client_business_id",
    ) {
      if (!["client_business_id", "id,client_business_id"].includes(fields))
        throw new MetaApiError("configuration");
      const business = await request(
        "me",
        businessSchema,
        "GET",
        new URLSearchParams({ fields }),
      );
      if (business.client_business_id !== options.credential.clientBusinessId)
        throw new MetaApiError(
          "authentication",
          undefined,
          undefined,
          undefined,
          "rejected",
        );
      return business;
    },
    // Separate evidence for investigation; does not establish system-user identity.
    async getClientBusinessPortfolio() {
      const business = await request(
        "me",
        z.object({ client_business_id: id }),
        "GET",
        new URLSearchParams({ fields: "client_business_id" }),
      );
      if (business.client_business_id !== options.credential.clientBusinessId)
        throw new MetaApiError(
          "authentication",
          undefined,
          undefined,
          undefined,
          "rejected",
        );
      return business;
    },
    getSystemUserIdentity() {
      return request(
        "me",
        z.object({ id }),
        "GET",
        new URLSearchParams({ fields: "id" }),
      );
    },
    async getAccount() {
      // /me is the system user. Never use it as the Instagram identity.
      // First page only; absence fails closed, even if another paging page exists.
      const accounts = await request(
        "me/assigned_instagram_accounts",
        assignedAccountsSchema,
        "GET",
        new URLSearchParams({ fields: "id,username" }),
      );
      const matches = accounts.data.filter(
        (account) => account.id === options.accountId,
      );
      if (matches.length !== 1)
        throw new MetaApiError(
          "authentication",
          undefined,
          undefined,
          undefined,
          "rejected",
        );
      return matches[0]!;
    },
    getCommentContext(commentId: string) {
      if (!id.safeParse(commentId).success)
        throw new MetaApiError("configuration");
      return request(
        commentId,
        z.object({
          id,
          timestamp: z
            .string()
            .refine((value) => Number.isFinite(Date.parse(value))),
          media: z.object({ id, media_product_type: z.string() }),
        }),
        "GET",
        new URLSearchParams({
          fields: "id,timestamp,media{id,media_product_type}",
        }),
      );
    },
    getTestCommentContext(commentId: string) {
      if (!id.safeParse(commentId).success)
        throw new MetaApiError("configuration");
      return request(
        commentId,
        z.object({
          id,
          timestamp: z
            .string()
            .refine((value) => Number.isFinite(Date.parse(value))),
          media: z.object({ id, media_product_type: z.string() }),
          from: z.object({ username: z.string().min(1) }),
        }),
        "GET",
        new URLSearchParams({
          fields: "id,timestamp,media{id,media_product_type},from",
        }),
      );
    },
    // First page only. Never follow upstream paging URLs that could contain credentials.
    listMedia() {
      return request(`${options.accountId}/media`, mediaSchema);
    },
    // Read-only, bounded first page for the private administrative dashboard.
    // Upstream paging URLs are deliberately discarded by schema validation.
    listDashboardMedia() {
      return request(
        `${options.accountId}/media`,
        dashboardMediaSchema,
        "GET",
        new URLSearchParams({
          fields:
            "id,media_type,caption,media_url,thumbnail_url,permalink,timestamp",
          limit: "25",
        }),
      );
    },
    listOneMedia() {
      return request(
        `${options.accountId}/media`,
        z.object({ data: z.array(z.object({ id })).max(1) }),
        "GET",
        new URLSearchParams({ fields: "id", limit: "1" }),
      );
    },
    listOneMediaComments(mediaId: string) {
      if (!id.safeParse(mediaId).success)
        throw new MetaApiError("configuration");
      return request(
        `${mediaId}/comments`,
        z.object({ data: z.array(z.object({ id })).max(1) }),
        "GET",
        new URLSearchParams({ fields: "id", limit: "1" }),
      );
    },
    listManualMedia() {
      return request(
        `${options.accountId}/media`,
        z.object({
          data: z
            .array(
              z.object({
                id,
                media_type: z.string(),
                timestamp: z.string().optional(),
                permalink: z.url().optional(),
                is_comment_enabled: z.boolean().optional(),
              }),
            )
            .max(10),
        }),
        "GET",
        new URLSearchParams({
          fields: "id,media_type,timestamp,permalink,is_comment_enabled",
          limit: "10",
        }),
      );
    },
    getManualMedia(mediaId: string) {
      if (!id.safeParse(mediaId).success)
        throw new MetaApiError("configuration");
      return request(
        mediaId,
        z.object({
          id,
          owner: z.object({ id }),
          media_type: z.string(),
          is_comment_enabled: z.boolean().optional(),
        }),
        "GET",
        new URLSearchParams({
          fields: "id,owner,media_type,is_comment_enabled",
        }),
      );
    },
    listManualComments(mediaId: string) {
      if (!id.safeParse(mediaId).success)
        throw new MetaApiError("configuration");
      return request(
        `${mediaId}/comments`,
        z.object({
          data: z
            .array(
              z.object({
                id,
                text: z.string().max(100000).optional(),
                timestamp: z
                  .string()
                  .refine((value) => Number.isFinite(Date.parse(value)))
                  .optional(),
                username: z.string().optional(),
                media: z.object({ id }).optional(),
              }),
            )
            .max(25),
        }),
        "GET",
        new URLSearchParams({
          fields: "id,text,timestamp,username,media{id}",
          limit: "25",
        }),
      );
    },
    // Explicit opt-in operation for manual setup; never called by webhook handlers.
    subscribeComments() {
      return request(
        `${options.accountId}/subscribed_apps`,
        z.object({ success: z.literal(true) }),
        "POST",
        new URLSearchParams({ subscribed_fields: "comments" }),
      );
    },
  });
}
