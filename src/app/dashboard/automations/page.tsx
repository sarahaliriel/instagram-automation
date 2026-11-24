import Link from "next/link";
import { getAutomations } from "@/server/dashboard/read-model";
import { AvailabilityState, PageHeader, StatusPill, formatDate } from "../ui";

const statuses = new Set(["ALL", "DRAFT", "ACTIVE", "ARCHIVED"]);

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const parameters = await searchParams;
  const status = statuses.has(parameters.status ?? "")
    ? (parameters.status as "ALL" | "DRAFT" | "ACTIVE" | "ARCHIVED")
    : "ALL";
  const query = parameters.q?.slice(0, 120) ?? "";
  const data = await getAutomations({ query, status });
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Regras"
        title="Automações"
        description="Crie e organize rascunhos sem ativar o motor de respostas ou iniciar entregas."
        action={
          <Link className="primary-link" href="/dashboard/automations/new">
            Nova automação
          </Link>
        }
      />
      <section className="notice accent">
        <strong>Ativação separada</strong>
        <span>
          Novas regras ficam em DRAFT. Não existe qualquer ação de ativação
          nesta fase.
        </span>
      </section>
      <form className="automation-filters" method="get" role="search">
        <label>
          <span>Pesquisar</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Nome ou palavra-chave"
            maxLength={120}
          />
        </label>
        <label>
          <span>Estado</span>
          <select name="status" defaultValue={status}>
            <option value="ALL">Todos</option>
            <option value="DRAFT">Rascunhos</option>
            <option value="ACTIVE">Ativas existentes</option>
            <option value="ARCHIVED">Arquivadas</option>
          </select>
        </label>
        <button type="submit">Aplicar filtros</button>
        {(query || status !== "ALL") && (
          <Link href="/dashboard/automations">Limpar</Link>
        )}
      </form>
      {data.items.length ? (
        <div className="rules-list">
          {data.items.map((rule) => {
            const tone = rule.status === "ACTIVE" ? "positive" : "neutral";
            return (
              <article className="panel rule-card" key={rule.id}>
                <div>
                  <div className="rule-title">
                    <h2>
                      <Link href={`/dashboard/automations/${rule.id}`}>
                        {rule.name}
                      </Link>
                    </h2>
                    <StatusPill tone={tone}>{rule.status}</StatusPill>
                  </div>
                  <p>
                    {rule.strategy === "EXACT"
                      ? "Correspondência exata"
                      : "Palavra completa"}{" "}
                    · {rule.executionCount} intenções · revisão {rule.revision}
                  </p>
                  <div className="keyword-list">
                    {rule.keywords.map((keyword) => (
                      <span key={keyword}>{keyword}</span>
                    ))}
                  </div>
                </div>
                <div className="rule-meta">
                  <time dateTime={rule.updatedAt.toISOString()}>
                    Atualizada {formatDate(rule.updatedAt)}
                  </time>
                  <Link href={`/dashboard/automations/${rule.id}`}>
                    Ver detalhes
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <AvailabilityState
          availability={data.availability}
          emptyTitle={
            query || status !== "ALL"
              ? "Nenhuma automação corresponde aos filtros"
              : "Ainda não existem regras"
          }
        />
      )}
      <section className="future-builder panel" aria-labelledby="future-review">
        <p className="eyebrow">Próxima etapa</p>
        <h2 id="future-review">Revisão e ativação</h2>
        <div className="builder-steps">
          <span>
            <b>1</b> Validar publicação
          </span>
          <span>
            <b>2</b> Rever correspondência
          </span>
          <span>
            <b>3</b> Aprovar mensagem
          </span>
          <span>
            <b>4</b> Ativar separadamente
          </span>
        </div>
        <p>
          Este fluxo é apenas informativo e não contém controlos funcionais.
        </p>
      </section>
    </div>
  );
}
