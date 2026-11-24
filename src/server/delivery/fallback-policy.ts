import type { MessagingOutcome } from "@/modules/instagram/messaging-adapter";

export const DEFAULT_PUBLIC_FALLBACK =
  "Olá! 💛 Não conseguimos enviar-te a informação por mensagem privada. Envia-nos uma DM com a palavra FORMULÁRIO para receberes as instruções.";
// No verified Unified-specific rejection code currently establishes safe public eligibility.
// Do not reuse Page Messages codes, infer profile privacy or expand this policy from error text.
export function fallbackEligibility(
  outcome: MessagingOutcome,
  mode: "MOCK" | "CONTROLLED_TEST",
) {
  if (mode === "MOCK" && outcome.kind === "SIMULATED_ELIGIBLE_REJECTION")
    return "SYNTHETIC_TEST_ONLY" as const;
  return null;
}
