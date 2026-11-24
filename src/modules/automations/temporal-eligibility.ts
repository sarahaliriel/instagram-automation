// Only a proven external creation time within the current activation can authorize
// a new decision. Receipt time supplies an independent upper bound.
export function isTemporallyEligible(
  activatedAt: Date | null,
  providerCreatedAt: Date | null,
  receivedAt: Date,
): boolean {
  if (!activatedAt || !providerCreatedAt) return false;
  const activation = activatedAt.getTime();
  const creation = providerCreatedAt.getTime();
  const receipt = receivedAt.getTime();
  return (
    Number.isFinite(activation) &&
    Number.isFinite(creation) &&
    Number.isFinite(receipt) &&
    creation > activation &&
    creation <= receipt
  );
}
