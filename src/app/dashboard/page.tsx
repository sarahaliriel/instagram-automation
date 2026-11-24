import Link from "next/link";
import { getDashboardSummary } from "@/server/dashboard/read-model";
import { AvailabilityState, PageHeader, StatusPill, formatDate } from "./ui";

export default async function DashboardPage() {
  const data = await getDashboardSummary();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="20 novembro 2026"
        title="Bom dia, GT Projeto."
        description="Uma leitura clara do que está ligado, do que aconteceu e do que merece atenção."
      />
      {data.stats ? (
        <section className="stats-grid" aria-label="Resumo real">
          {[
            ["Publicações guardadas", data.stats.posts],
            ["Regras existentes", data.stats.rules],
            ["Eventos recebidos", data.stats.events],
            ["Ações de entrega", data.stats.deliveryActions],
          ].map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
      ) : (
        <AvailabilityState availability={data.availability} />
      )}
      <div className="overview-grid">
        <section className="panel connection-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Instagram</p>
              <h2>Estado da ligação</h2>
            </div>
            <StatusPill
              tone={
                data.account.username
                  ? "positive"
                  : data.account.configured
                    ? "warning"
                    : "neutral"
              }
            >
              {data.account.username
                ? "Ligado"
                : data.account.configured
                  ? "Verificação pendente"
                  : "Desligado"}
            </StatusPill>
          </div>
          <div className="account-row">
            <span className="account-avatar" aria-hidden="true">
              @
            </span>
            <div>
              <strong>
                {data.account.username
                  ? `@${data.account.username}`
                  : "Conta não verificada"}
              </strong>
              <p>
                {data.account.mode === "read_only"
                  ? "Leitura administrativa"
                  : data.account.mode === "development"
                    ? "Integração de desenvolvimento"
                    : "Integração desativada"}
              </p>
            </div>
          </div>
          <p className="fine-print">
            Apenas leitura nesta interface. Tokens e identificadores privados
            nunca são enviados ao browser.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Automações</p>
              <h2>Estado atual</h2>
            </div>
            <Link href="/dashboard/automations">Ver regras</Link>
          </div>
          {data.automation ? (
            <div className="automation-summary">
              <strong>{data.automation.enabled}</strong>
              <span>ativas de {data.automation.total} regras existentes</span>
              <div className="meter">
                <span
                  style={{
                    width: `${data.automation.total ? (data.automation.enabled / data.automation.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>A ativação e edição permanecem bloqueadas nesta fase.</p>
            </div>
          ) : (
            <AvailabilityState availability={data.availability} />
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2>Atividade recente</h2>
          </div>
          <Link href="/dashboard/activity">Ver tudo</Link>
        </div>
        {data.recentActivity.length ? (
          <div className="activity-list">
            {data.recentActivity.map((item) => (
              <article key={item.id}>
                <span className={`activity-dot ${item.tone}`} />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <time dateTime={item.createdAt.toISOString()}>
                  {formatDate(item.createdAt)}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <AvailabilityState availability={data.availability} />
        )}
      </section>
    </div>
  );
}
