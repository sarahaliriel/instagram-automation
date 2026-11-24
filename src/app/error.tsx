"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main">
      <h1>Não foi possível carregar esta página</h1>
      <p>Tenta novamente dentro de momentos.</p>
      <button onClick={reset}>Tentar novamente</button>
    </main>
  );
}
