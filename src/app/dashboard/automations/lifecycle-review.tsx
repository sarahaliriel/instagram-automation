"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { initialAutomationActionState } from "./action-state";
import {
  activateAutomationAction,
  deactivateAutomationAction,
  reviewAutomationAction,
} from "./actions";

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? "A confirmar…" : children}
    </button>
  );
}

function LifecycleMutationForm({
  id,
  revision,
  reviewDigest,
  target,
}: {
  id: string;
  revision: number;
  reviewDigest: string;
  target: "ACTIVE" | "DRAFT";
}) {
  const action =
    target === "ACTIVE"
      ? activateAutomationAction.bind(null, id, revision)
      : deactivateAutomationAction.bind(null, id, revision);
  const [state, formAction] = useActionState(
    action,
    initialAutomationActionState,
  );
  const confirmation = target === "ACTIVE" ? "ATIVAR" : "DESATIVAR";
  return (
    <form action={formAction} className="lifecycle-confirmation">
      <input type="hidden" name="reviewDigest" value={reviewDigest} />
      <label>
        <span>
          Escreva <strong>{confirmation}</strong> para confirmar
        </span>
        <input
          name="confirmation"
          required
          autoComplete="off"
          pattern={confirmation}
          aria-describedby="lifecycle-consequence"
        />
      </label>
      <p id="lifecycle-consequence">
        {target === "ACTIVE"
          ? "A regra ficará elegível para matching. Isto não liga webhooks, jobs ou delivery."
          : "A regra deixa de ser elegível para novos matches. Intenções e tentativas existentes não são eliminadas."}
      </p>
      <SubmitButton>
        {target === "ACTIVE" ? "Ativar regra" : "Desativar regra"}
      </SubmitButton>
      <div
        className={`form-feedback ${state.status}`}
        role={
          state.status === "error" || state.status === "conflict"
            ? "alert"
            : "status"
        }
        aria-live="polite"
        hidden={state.status === "idle"}
      >
        {state.message}
      </div>
    </form>
  );
}

export function LifecycleReview({
  id,
  revision,
}: {
  id: string;
  revision: number;
}) {
  const [state, action] = useActionState(
    reviewAutomationAction.bind(null, id, revision),
    initialAutomationActionState,
  );
  return (
    <section className="panel lifecycle-review">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Revisão administrativa</p>
          <h2>Confirmar antes de alterar o estado</h2>
        </div>
      </div>
      {!state.review ? (
        <form action={action}>
          <p>
            A mensagem permanece cifrada até esta ação autenticada confirmar
            novamente a publicação na Meta.
          </p>
          <SubmitButton>Rever configuração</SubmitButton>
          <div
            className={`form-feedback ${state.status}`}
            role={
              state.status === "error" || state.status === "conflict"
                ? "alert"
                : "status"
            }
            aria-live="polite"
            hidden={state.status === "idle"}
          >
            {state.message}
          </div>
        </form>
      ) : (
        <div className="review-result">
          <dl>
            <div>
              <dt>Nome</dt>
              <dd>{state.review.name}</dd>
            </div>
            <div>
              <dt>Publicação</dt>
              <dd>{state.review.mediaProviderId}</dd>
            </div>
            <div>
              <dt>Keyword</dt>
              <dd>{state.review.keyword}</dd>
            </div>
            <div>
              <dt>Matching</dt>
              <dd>{state.review.strategy}</dd>
            </div>
            <div>
              <dt>Prioridade</dt>
              <dd>{state.review.priority}</dd>
            </div>
            <div>
              <dt>Estado · revisão</dt>
              <dd>
                {state.review.status} · {state.review.revision}
              </dd>
            </div>
            <div>
              <dt>Fallback público</dt>
              <dd>
                {state.review.publicFallbackEnabled
                  ? "Configurado — ativação bloqueada"
                  : "Desativado"}
              </dd>
            </div>
          </dl>
          <div className="private-template">
            <span>Pré-visualização privada — não guardada em cache</span>
            <p>{state.review.privateMessageTemplate}</p>
          </div>
          <div className="conflict-review">
            <strong>Conflitos de matching</strong>
            {state.review.conflicts.length ? (
              <ul>
                {state.review.conflicts.map((conflict) => (
                  <li key={conflict.ruleId}>
                    {conflict.name}: {conflict.overlappingKeywords.join(", ")} ·{" "}
                    {conflict.precedence === "CANDIDATE_WINS"
                      ? "esta regra tem precedência"
                      : "a regra existente tem precedência"}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nenhuma sobreposição ativa detetada nesta publicação.</p>
            )}
          </div>
          {state.review.status === "DRAFT" &&
          !state.review.publicFallbackEnabled ? (
            <LifecycleMutationForm
              id={state.review.id}
              revision={state.review.revision}
              reviewDigest={state.review.reviewDigest}
              target="ACTIVE"
            />
          ) : state.review.status === "ACTIVE" ? (
            <LifecycleMutationForm
              id={state.review.id}
              revision={state.review.revision}
              reviewDigest={state.review.reviewDigest}
              target="DRAFT"
            />
          ) : state.review.status === "ARCHIVED" ? (
            <p className="fine-print">
              Regras arquivadas podem ser revistas, mas não reativadas.
            </p>
          ) : (
            <p className="fine-print">
              A ativação foi bloqueada porque esta regra contém fallback público
              configurado.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
