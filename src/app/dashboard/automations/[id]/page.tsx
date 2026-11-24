import Link from "next/link";
import { notFound } from "next/navigation";
import { getAutomationDetail } from "@/server/dashboard/read-model";
import { PageHeader, StatusPill } from "../../ui";
import { ArchiveForm } from "../archive-form";
import { LifecycleReview } from "../lifecycle-review";

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rule = await getAutomationDetail(id);
  if (!rule) notFound();
  const tone = rule.status === "ACTIVE" ? "positive" : "neutral";
  return (
    <div className="page-stack narrow-page">
      <PageHeader
        eyebrow="Detalhe da regra"
        title={rule.name}
        description="Vista privada de uma automação. O template só é decifrado após uma revisão administrativa explícita."
        action={<StatusPill tone={tone}>{rule.status}</StatusPill>}
      />
      <section className="panel automation-detail">
        <dl>
          <div>
            <dt>Estado</dt>
            <dd>{rule.status}</dd>
          </div>
          <div>
            <dt>Correspondência</dt>
            <dd>
              {rule.strategy === "EXACT"
                ? "Comentário exato"
                : "Palavra completa"}
            </dd>
          </div>
          <div>
            <dt>Palavra-chave</dt>
            <dd>{rule.keyword}</dd>
          </div>
          <div>
            <dt>Publicação</dt>
            <dd>{rule.mediaProviderId}</dd>
          </div>
          <div>
            <dt>Prioridade</dt>
            <dd>{rule.priority}</dd>
          </div>
          <div>
            <dt>Revisão</dt>
            <dd>{rule.revision}</dd>
          </div>
          <div>
            <dt>Intenções persistidas</dt>
            <dd>{rule.executionCount}</dd>
          </div>
        </dl>
      </section>
      <div className="detail-actions">
        {rule.editable ? (
          <Link
            className="primary-link"
            href={`/dashboard/automations/${rule.id}/edit`}
          >
            Editar rascunho
          </Link>
        ) : (
          <span>
            Esta regra não pode ser editada porque está ativa, arquivada ou já
            produziu intenções.
          </span>
        )}
        {rule.status === "DRAFT" ? (
          <ArchiveForm id={rule.id} revision={rule.revision} />
        ) : null}
      </div>
      <LifecycleReview id={rule.id} revision={rule.revision} />
      <section className="notice accent">
        <strong>ACTIVE não significa envio automático</strong>
        <span>
          Webhooks, Inngest, delivery e fallback continuam sujeitos aos seus
          próprios controlos, todos desativados neste ambiente.
        </span>
      </section>
    </div>
  );
}
