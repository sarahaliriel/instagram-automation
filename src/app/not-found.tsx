import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main">
      <h1>Página não encontrada</h1>
      <Link href="/">Voltar ao início</Link>
    </main>
  );
}
