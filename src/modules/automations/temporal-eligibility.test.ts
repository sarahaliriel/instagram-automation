import { describe, expect, it } from "vitest";
import { isTemporallyEligible } from "./temporal-eligibility";

const at = (value: number) => new Date(value);
describe("temporal eligibility", () => {
  it("requires creation strictly after the current activation and no later than receipt", () => {
    expect(isTemporallyEligible(at(20), at(19), at(30))).toBe(false);
    expect(isTemporallyEligible(at(20), at(20), at(30))).toBe(false);
    expect(isTemporallyEligible(at(20), at(21), at(30))).toBe(true);
    expect(isTemporallyEligible(at(20), at(31), at(30))).toBe(false);
  });
  it("rejects backlog from an earlier activation after reactivation", () => {
    expect(isTemporallyEligible(at(10), at(15), at(20))).toBe(true);
    expect(isTemporallyEligible(at(30), at(15), at(20))).toBe(false);
    expect(isTemporallyEligible(at(30), at(35), at(40))).toBe(true);
  });
  it("fails closed for absent or invalid temporal evidence", () => {
    expect(isTemporallyEligible(null, at(21), at(30))).toBe(false);
    expect(isTemporallyEligible(at(20), null, at(30))).toBe(false);
    expect(isTemporallyEligible(at(NaN), at(21), at(30))).toBe(false);
    expect(isTemporallyEligible(at(20), at(NaN), at(30))).toBe(false);
    expect(isTemporallyEligible(at(20), at(21), at(NaN))).toBe(false);
  });
});
