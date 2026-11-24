import { getDashboardSummary } from "@/server/dashboard/read-model";
import { PageHeader, StatusPill } from "../ui";

export default async function SettingsPage() {
  const data = await getDashboardSummary();
  const rows = [
    [
      "Instagram Unified Login",
      data.account.username
        ? "Ligado"
        : data.account.configured
          ? "Configurado, não verificado"
          : "Desligado",
      data.account.username ? "positive" : "neutral",
      data.account.username ? "Operacional" : "Protegido",
    ],
    [
      "Base de dados",
      data.availability === "available"
        ? "Disponível"
        : data.availability === "unconfigured"
          ? "Não configurada"
          : "Indisponível",
      data.availability === "available" ? "positive" : "warning",
      data.availability === "available" ? "Operacional" : "Atenção",
    ],
    [
      "Leitura administrativa Meta",
      data.controls.adminMetaReads ? "Habilitada no servidor" : "Desativada",
      data.controls.adminMetaReads ? "positive" : "neutral",
      data.controls.adminMetaReads ? "Leitura" : "Desativado",
    ],
    [
      "Ingestão de webhooks",
      data.controls.webhooks ? "Habilitada" : "Desativada",
      data.controls.webhooks ? "warning" : "neutral",
      data.controls.webhooks ? "Ativa" : "Desativado",
    ],
    [
      "Jobs",
      data.controls.jobs ? "Habilitados" : "Desativados",
      data.controls.jobs ? "warning" : "neutral",
      data.controls.jobs ? "Ativos" : "Desativado",
    ],
    [
      "Delivery automático",
      data.controls.delivery ? "Habilitado" : "Desativado",
      data.controls.delivery ? "warning" : "neutral",
      data.controls.delivery ? "Ativo" : "Desativado",
    ],
    [
      "Fallback público",
      data.controls.publicFallback ? "Habilitado" : "Desativado",
      data.controls.publicFallback ? "warning" : "neutral",
      data.controls.publicFallback ? "Ativo" : "Desativado",
    ],
  ] as const;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Sistema"
        title="Definições"
        description="Estado seguro das integrações e controlos operacionais. Segredos, tokens e valores cifrados nunca são apresentados."
      />
      <section className="panel settings-list">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Integrações</p>
            <h2>Estado operacional</h2>
          </div>
        </div>
        {rows.map(([name, value, tone, status]) => (
          <article key={name}>
            <div>
              <strong>{name}</strong>
              <p>{value}</p>
            </div>
            <StatusPill tone={tone}>{status}</StatusPill>
          </article>
        ))}
      </section>
      <section className="panel safeguards">
        <p className="eyebrow">Guardrails</p>
        <h2>Controlos preservados</h2>
        <ul>
          <li>Sem POSTs à Meta a partir do dashboard</li>
          <li>Credenciais confinadas ao servidor</li>
          <li>Webhook, delivery, jobs e fallback explicitamente sinalizados</li>
          <li>Ledger e tentativas anteriores inalterados</li>
          <li>Autenticação obrigatória em todas as páginas administrativas</li>
        </ul>
      </section>
    </div>
  );
}
