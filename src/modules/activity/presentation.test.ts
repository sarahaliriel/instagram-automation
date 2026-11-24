import { describe, expect, it } from "vitest";
import { presentDeliveryState } from "./presentation";

describe("activity presentation", () => {
  it("does not describe Meta acceptance as confirmed receipt", () => {
    const result = presentDeliveryState("ACCEPTED_BY_META");
    expect(result.label).toBe("Aceite pela Meta");
    expect(result.detail).toContain("não confirma receção");
  });

  it("keeps uncertain delivery visibly distinct", () => {
    expect(presentDeliveryState("UNKNOWN_OUTCOME")).toMatchObject({
      tone: "critical",
      label: "Resultado incerto",
    });
  });
});
