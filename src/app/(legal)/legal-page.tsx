import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./legal.module.css";

type SectionLink = { id: string; label: string };

export function LegalPage({
  title,
  lead,
  sections,
  children,
}: {
  title: string;
  lead: string;
  sections: SectionLink[];
  children: ReactNode;
}) {
  return (
    <>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>GT Projeto / Informação institucional</p>
        <h1>{title}</h1>
        <p className={styles.lead}>{lead}</p>
        <p className={styles.updated}>
          Versão de trabalho · 23 de novembro de 2026
        </p>
      </header>
      <div className={styles.grid}>
        <nav className={styles.toc} aria-label={`Secções de ${title}`}>
          <p className={styles.tocTitle}>Nesta página</p>
          <ul>
            {sections.map(({ id, label }) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <article className={styles.article}>
          {children}
          <div className={styles.related}>
            <p>
              Autora do software: Sarah Aliriel Dumitrache ·{" "}
              <a href="https://sarahaliriel.tech">Portfólio</a> ·{" "}
              <a href="mailto:dumitrachebusiness@gmail.com">Email</a> ·{" "}
              <a href="tel:+351914137185">+351 914 137 185</a>
            </p>
            <h2>Outras informações</h2>
            <nav aria-label="Outras páginas institucionais">
              <Link href="/privacy">Privacidade</Link>
              <Link href="/terms">Termos de utilização</Link>
              <Link href="/data-deletion">Eliminação de dados</Link>
            </nav>
          </div>
        </article>
      </div>
    </>
  );
}
