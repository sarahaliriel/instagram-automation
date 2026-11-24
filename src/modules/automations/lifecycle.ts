export type RuleLifecycleState = Readonly<{
  enabled: boolean;
  archivedAt: Date | null;
  revision: number;
}>;

export type LifecycleErrorCode =
  "CONFLICT" | "NOT_ACTIVATABLE" | "NOT_DEACTIVATABLE" | "DELIVERY_IN_FLIGHT";

export function validateLifecycleTransition(
  state: RuleLifecycleState,
  expectedRevision: number,
  target: "ACTIVE" | "DRAFT",
  hasInFlightDelivery = false,
): LifecycleErrorCode | null {
  if (state.revision !== expectedRevision) return "CONFLICT";
  if (state.archivedAt)
    return target === "ACTIVE" ? "NOT_ACTIVATABLE" : "NOT_DEACTIVATABLE";
  if (target === "ACTIVE" && state.enabled) return "NOT_ACTIVATABLE";
  if (target === "DRAFT" && !state.enabled) return "NOT_DEACTIVATABLE";
  if (target === "DRAFT" && hasInFlightDelivery) return "DELIVERY_IN_FLIGHT";
  return null;
}
