import Link from "next/link";
import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Informação institucional | GT Projeto — Instagram Automation",
  description:
    "Informação de privacidade, termos de utilização e eliminação de dados do GT Projeto — Instagram Automation.",
  robots: { index: false, follow: false },
};

export default function HomePage() {
  return (
    <main id="main" className={styles.main}>
      <p className={styles.eyebrow}>GT Projeto / Informação institucional</p>
      <h1>Informação sobre a nossa ferramenta</h1>
      <p className={styles.lead}>
        GT Projeto — Instagram Automation apoia a gestão autorizada de
        interações da conta profissional autorizada. Consulte aqui as
        informações sobre dados e utilização da aplicação.
      </p>
      <nav aria-label="Páginas institucionais" className={styles.cards}>
        <Link href="/privacy">
          <span>01 / Privacidade</span>
          <strong>Como tratamos os dados</strong>
          <span>
            Conheça os dados envolvidos e as decisões ainda pendentes.
          </span>
        </Link>
        <Link href="/terms">
          <span>02 / Utilização</span>
          <strong>Termos da ferramenta</strong>
          <span>Entenda o âmbito e as condições de utilização.</span>
        </Link>
        <Link href="/data-deletion">
          <span>03 / Pedidos</span>
          <strong>Eliminação de dados</strong>
          <span>Saiba como serão analisados os pedidos de apagamento.</span>
        </Link>
      </nav>
      <p className={styles.draft}>
        Versão de trabalho. O procedimento operacional de eliminação ainda
        aguarda validação antes da publicação.
      </p>
    </main>
  );
}
