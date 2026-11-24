"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { initialAutomationActionState } from "./action-state";
import { createAutomationAction, updateAutomationAction } from "./actions";

type PostOption = Readonly<{
  id: string;
  caption: string | null;
  timestamp: Date;
}>;

type DraftValues = Readonly<{
  id: string;
  revision: number;
  name: string;
  mediaProviderId: string | null;
  strategy: "EXACT" | "WHOLE_WORD";
  keyword: string;
  privateMessageTemplate: string;
}>;

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending
        ? "A guardar…"
        : editing
          ? "Guardar alterações"
          : "Criar rascunho"}
    </button>
  );
}

export function AutomationForm({
  accountUsername,
  posts,
  draft,
}: {
  accountUsername: string;
  posts: readonly PostOption[];
  draft?: DraftValues;
}) {
  const action = draft
    ? updateAutomationAction.bind(null, draft.id, draft.revision)
    : createAutomationAction;
  const [state, formAction] = useActionState(
    action,
    initialAutomationActionState,
  );
  const editing = Boolean(draft);
  return (
    <form action={formAction} className="automation-form" noValidate>
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
        {state.status === "success" && state.id ? (
          <Link href={`/dashboard/automations/${state.id}`}>Ver detalhes</Link>
        ) : null}
      </div>
      <fieldset>
        <legend>Identificação</legend>
        <label>
          <span>Nome interno</span>
          <input
            name="name"
            defaultValue={draft?.name}
            required
            maxLength={120}
            aria-describedby={
              state.fieldErrors?.name ? "name-error" : undefined
            }
          />
          {state.fieldErrors?.name ? (
            <small id="name-error" className="field-error">
              Introduza um nome entre 1 e 120 caracteres.
            </small>
          ) : null}
        </label>
        <label>
          <span>Conta Instagram autorizada</span>
          <input value={`@${accountUsername}`} readOnly aria-readonly="true" />
        </label>
      </fieldset>
      <fieldset>
        <legend>Quando responder</legend>
        <label>
          <span>Publicação</span>
          <select
            name="mediaProviderId"
            required
            defaultValue={draft?.mediaProviderId ?? ""}
            aria-describedby={
              state.fieldErrors?.mediaProviderId ? "media-error" : undefined
            }
          >
            <option value="" disabled>
              Selecione uma publicação
            </option>
            {posts.map((post) => (
              <option key={post.id} value={post.id}>
                {(post.caption?.trim() || "Publicação sem legenda").slice(
                  0,
                  72,
                )}
              </option>
            ))}
          </select>
          {state.fieldErrors?.mediaProviderId ? (
            <small id="media-error" className="field-error">
              Selecione uma publicação autorizada.
            </small>
          ) : null}
        </label>
        <div className="form-split">
          <label>
            <span>Palavra-chave</span>
            <input
              name="keyword"
              defaultValue={draft?.keyword}
              required
              maxLength={200}
              aria-describedby={
                state.fieldErrors?.keyword ? "keyword-error" : undefined
              }
            />
            {state.fieldErrors?.keyword ? (
              <small id="keyword-error" className="field-error">
                Introduza uma palavra-chave válida.
              </small>
            ) : null}
          </label>
          <label>
            <span>Correspondência</span>
            <select
              name="strategy"
              defaultValue={draft?.strategy ?? "WHOLE_WORD"}
            >
              <option value="WHOLE_WORD">Palavra completa</option>
              <option value="EXACT">Comentário exato</option>
            </select>
          </label>
        </div>
        <p className="form-help">
          A normalização ignora maiúsculas e acentos. Não são usadas expressões
          regulares nem correspondência aproximada.
        </p>
      </fieldset>
      <fieldset>
        <legend>Mensagem privada</legend>
        <label>
          <span>Texto da resposta</span>
          <textarea
            name="privateMessageTemplate"
            defaultValue={draft?.privateMessageTemplate}
            required
            rows={6}
            aria-describedby="message-help"
          />
          <small id="message-help" className="form-help">
            Texto literal até 1000 bytes. Este conteúdo será cifrado antes de
            ser persistido.
          </small>
        </label>
      </fieldset>
      <div className="form-actions">
        <SubmitButton editing={editing} />
        <Link href="/dashboard/automations">Cancelar</Link>
        <span>O rascunho não será ativado.</span>
      </div>
    </form>
  );
}
