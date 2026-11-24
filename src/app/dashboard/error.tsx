"use client";
export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state error-state">
      <span aria-hidden="true">!</span>
      <h1>Não foi possível carregar esta vista</h1>
      <p>
        Os detalhes técnicos permaneceram no servidor. Pode tentar novamente em
        segurança.
      </p>
      <button type="button" onClick={reset}>
        Tentar novamente
      </button>
    </div>
  );
}
