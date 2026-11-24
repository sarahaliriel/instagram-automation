import type { ReactNode } from "react";
import type { DataAvailability } from "@/server/dashboard/read-model";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">○</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function AvailabilityState({
  availability,
  emptyTitle = "Ainda sem registos",
}: {
  availability: DataAvailability;
  emptyTitle?: string;
}) {
  if (availability === "unconfigured")
    return (
      <EmptyState title="Fonte de dados por configurar">
        Configure o ambiente server-side para consultar dados reais. Nenhum
        valor foi estimado.
      </EmptyState>
    );
  if (availability === "unavailable")
    return (
      <EmptyState title="Dados temporariamente indisponíveis">
        A fonte não respondeu. As credenciais e detalhes do erro permanecem
        privados.
      </EmptyState>
    );
  return (
    <EmptyState title={emptyTitle}>
      Os dados estão disponíveis, mas ainda não existem registos para
      apresentar.
    </EmptyState>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "neutral" | "positive" | "warning" | "critical";
  children: ReactNode;
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
