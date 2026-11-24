import { describe, expect, it } from "vitest";
import { validateLifecycleTransition } from "./lifecycle";

describe("automation lifecycle", () => {
  it("allows explicit draft activation and active deactivation", () => {
    expect(
      validateLifecycleTransition(
        { enabled: false, archivedAt: null, revision: 2 },
        2,
        "ACTIVE",
      ),
    ).toBeNull();
    expect(
      validateLifecycleTransition(
        { enabled: true, archivedAt: null, revision: 3 },
        3,
        "DRAFT",
      ),
    ).toBeNull();
  });

  it("rejects archived, stale, repeated and in-flight transitions", () => {
    const archived = {
      enabled: false,
      archivedAt: new Date(),
      revision: 3,
    };
    expect(validateLifecycleTransition(archived, 3, "ACTIVE")).toBe(
      "NOT_ACTIVATABLE",
    );
    expect(
      validateLifecycleTransition(
        { enabled: false, archivedAt: null, revision: 2 },
        1,
        "ACTIVE",
      ),
    ).toBe("CONFLICT");
    expect(
      validateLifecycleTransition(
        { enabled: true, archivedAt: null, revision: 3 },
        3,
        "ACTIVE",
      ),
    ).toBe("NOT_ACTIVATABLE");
    expect(
      validateLifecycleTransition(
        { enabled: true, archivedAt: null, revision: 3 },
        3,
        "DRAFT",
        true,
      ),
    ).toBe("DELIVERY_IN_FLIGHT");
  });
});
