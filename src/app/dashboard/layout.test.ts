import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./dashboard-nav", () => ({ DashboardNav: () => null }));

describe("dashboard layout", () => {
  it("keeps request rendering dynamic without suspending the shared layout", async () => {
    const { default: DashboardLayout, dynamic } = await import("./layout");
    const rendered = DashboardLayout({ children: "activity" });

    expect(dynamic).toBe("force-dynamic");
    expect(rendered).not.toBeInstanceOf(Promise);
    expect(isValidElement(rendered)).toBe(true);
  });
});
