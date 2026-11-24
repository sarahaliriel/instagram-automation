import { describe, expect, it } from "vitest";
import {
  assertLoginDefault,
  buildCreateArgs,
} from "../../../scripts/meta-keychain-command.mjs";

describe("native Meta Keychain setup", () => {
  it("constructs a prompt command with -w last and no secret argument", () => {
    const args = buildCreateArgs(
      "instagram-automation.local.meta-system-user-access-token",
    );
    expect(args).toEqual([
      "add-generic-password",
      "-a",
      "development",
      "-s",
      "instagram-automation.local.meta-system-user-access-token",
      "-w",
    ]);
    expect(args).not.toContain("-U");
    expect(args).not.toContain("-A");
    expect(args.at(-1)).toBe("-w");
  });

  it("rejects a different default Keychain before secret entry", () => {
    const login = "/Users/test/Library/Keychains/login.keychain-db";
    expect(() => assertLoginDefault(`  "${login}"\n`, login)).not.toThrow();
    expect(() =>
      assertLoginDefault(
        '"/Users/test/Library/Keychains/other.keychain-db"',
        login,
      ),
    ).toThrow("The user default Keychain is not login");
  });
});
