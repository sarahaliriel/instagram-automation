export type DeliveryPresentation = Readonly<{
  label: string;
  tone: "neutral" | "positive" | "warning" | "critical";
  detail: string;
}>;

const presentations: Record<string, DeliveryPresentation> = {
  PENDING_DELIVERY: {
    label: "Pendente",
    tone: "neutral",
    detail: "Registada no ledger; ainda não enviada.",
  },
  SENDING: {
    label: "Em processamento",
    tone: "warning",
    detail: "Tentativa iniciada; resultado ainda não estabelecido.",
  },
  ACCEPTED_BY_META: {
    label: "Aceite pela Meta",
    tone: "positive",
    detail:
      "A API aceitou o pedido. Isto não confirma receção pelo destinatário.",
  },
  FAILED_RETRYABLE: {
    label: "Falha temporária",
    tone: "warning",
    detail: "Falha classificada como recuperável pelo motor existente.",
  },
  FAILED_PERMANENT: {
    label: "Falha permanente",
    tone: "critical",
    detail: "A tentativa foi rejeitada de forma definitiva.",
  },
  UNKNOWN_OUTCOME: {
    label: "Resultado incerto",
    tone: "critical",
    detail: "Não é seguro repetir automaticamente; requer revisão.",
  },
  FALLBACK_ELIGIBLE: {
    label: "Fallback elegível",
    tone: "warning",
    detail: "Elegibilidade registada; nenhum envio é iniciado pelo dashboard.",
  },
  FALLBACK_ACCEPTED_BY_META: {
    label: "Fallback aceite pela Meta",
    tone: "positive",
    detail: "A API aceitou o fallback; a receção não está confirmada.",
  },
  MANUAL_REVIEW: {
    label: "Revisão manual",
    tone: "critical",
    detail: "Ação humana necessária; o dashboard não altera este estado.",
  },
};

export function presentDeliveryState(state: string): DeliveryPresentation {
  return (
    presentations[state] ?? {
      label: "Estado registado",
      tone: "neutral",
      detail: "Estado persistido no ledger.",
    }
  );
}
