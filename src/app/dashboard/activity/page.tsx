import { getActivity } from "@/server/dashboard/read-model";
import { AvailabilityState, PageHeader, StatusPill, formatDate } from "../ui";

export default async function ActivityPage() {
  const data = await getActivity();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operações"
        title="Atividade"
        description="Estados sanitizados do ledger. Aceitação pela Meta é apresentada separadamente de qualquer confirmação de receção."
      />
      <section className="notice accent">
        <strong>Importante</strong>
        <span>
          ACCEPTED_BY_META significa apenas que a API aceitou o pedido — não
          prova entrega ao destinatário.
        </span>
      </section>
      {data.items.length ? (
        <section
          className="activity-table panel"
          aria-label="Atividade de entrega"
        >
          <div className="table-head">
            <span>Estado</span>
            <span>Tipo</span>
            <span>Tentativas</span>
            <span>Data</span>
          </div>
          {data.items.map((item) => (
            <article key={item.id}>
              <div>
                <StatusPill tone={item.tone}>{item.label}</StatusPill>
                <p>{item.detail}</p>
              </div>
              <span>
                {item.kind === "PRIVATE_REPLY"
                  ? "Resposta privada"
                  : "Fallback público"}
                <small>
                  {item.mode === "MOCK" ? "Simulação" : "Teste controlado"}
                </small>
              </span>
              <span>{item.attempts}</span>
              <time dateTime={item.createdAt.toISOString()}>
                {formatDate(item.createdAt)}
              </time>
            </article>
          ))}
        </section>
      ) : (
        <AvailabilityState
          availability={data.availability}
          emptyTitle="Ainda não existe atividade"
        />
      )}
    </div>
  );
}
