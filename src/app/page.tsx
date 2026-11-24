import styles from "./page.module.css";

export default function Home() {
  return (
    <main id="main" className={styles.main}>
      <p className={styles.eyebrow}>Base do projeto</p>
      <h1>Instagram Automation Manager</h1>
      <p>
        Aplicação privada para gerir automações de comentários e respostas no
        Instagram.
      </p>
      <section aria-labelledby="status-heading" className={styles.status}>
        <h2 id="status-heading">Integrações por configurar</h2>
        <p>
          A persistência e o processamento assíncrono estão disponíveis para
          desenvolvimento. A autenticação e o painel operacional serão
          implementados noutra fase.
        </p>
        <p>
          A integração permanece desativada por defeito. A aplicação não envia
          mensagens.
        </p>
      </section>
      <a href="/api/health">Verificar resposta da aplicação</a>
    </main>
  );
}
