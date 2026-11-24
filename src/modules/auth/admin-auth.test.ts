import { describe, expect, it } from "vitest";
import { isAuthorizedAdmin, parseAdminCredentials } from "./admin-auth";

const credentials = { username: "admin", password: "a-secure-password" };

describe("administrator authentication", () => {
  it("fails closed when configuration is absent or weak", () => {
    expect(parseAdminCredentials({})).toBeNull();
    expect(
      parseAdminCredentials({
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "short",
      }),
    ).toBeNull();
  });

  it("accepts only an exact Basic credential pair", async () => {
    const header = `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
    await expect(isAuthorizedAdmin(header, credentials)).resolves.toBe(true);
    await expect(
      isAuthorizedAdmin(
        `Basic ${btoa(`${credentials.username}:wrong-password-value`)}`,
        credentials,
      ),
    ).resolves.toBe(false);
    await expect(isAuthorizedAdmin(null, credentials)).resolves.toBe(false);
  });
});
