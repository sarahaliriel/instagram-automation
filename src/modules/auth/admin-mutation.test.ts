import { describe, expect, it } from "vitest";
import { isAuthorizedAdminMutation } from "./admin-mutation";

const credentials = { username: "admin", password: "a-secure-password" };
const authorization = `Basic ${btoa("admin:a-secure-password")}`;

describe("administrative mutation authorization", () => {
  it("requires authentication and exact same-origin metadata", async () => {
    await expect(
      isAuthorizedAdminMutation(
        {
          authorization,
          origin: "https://admin.example",
          host: "admin.example",
        },
        credentials,
        "https://admin.example",
      ),
    ).resolves.toBe(true);
    await expect(
      isAuthorizedAdminMutation(
        {
          authorization,
          origin: "https://attacker.example",
          host: "admin.example",
        },
        credentials,
        "https://admin.example",
      ),
    ).resolves.toBe(false);
  });

  it("fails closed when origin, host, app URL or credentials are absent", async () => {
    for (const request of [
      {
        authorization: null,
        origin: "https://admin.example",
        host: "admin.example",
      },
      { authorization, origin: null, host: "admin.example" },
      { authorization, origin: "https://admin.example", host: null },
    ]) {
      await expect(
        isAuthorizedAdminMutation(
          request,
          credentials,
          "https://admin.example",
        ),
      ).resolves.toBe(false);
    }
  });
});
