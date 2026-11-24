"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { initialAutomationActionState } from "./action-state";
import { archiveAutomationAction } from "./actions";

function ArchiveSubmit() {
  const { pending } = useFormStatus();
  return (
    <button className="danger-button" type="submit" disabled={pending}>
      {pending ? "A arquivar…" : "Arquivar automação"}
    </button>
  );
}

export function ArchiveForm({
  id,
  revision,
}: {
  id: string;
  revision: number;
}) {
  const [state, action] = useActionState(
    archiveAutomationAction.bind(null, id, revision),
    initialAutomationActionState,
  );
  return (
    <form action={action} className="archive-form">
      <ArchiveSubmit />
      <p
        role={
          state.status === "error" || state.status === "conflict"
            ? "alert"
            : "status"
        }
        aria-live="polite"
      >
        {state.message}
      </p>
    </form>
  );
}
