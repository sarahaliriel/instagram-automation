import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GT Projeto — Instagram Automation",
  description:
    "Informação sobre a ferramenta de gestão de interações Instagram do GT Projeto.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-PT">
      <body>
        <a className="skip-link" href="#main">
          Saltar para o conteúdo
        </a>
        <header className="site-header">
          <span className="site-name">GT Projeto</span>
          <span className="site-divider" aria-hidden="true" />
          <span className="site-description">Instagram Automation</span>
        </header>
        {children}
        <footer className="site-footer">
          <span>GT Projeto — Instagram Automation</span>
          <nav aria-label="Informação institucional">
            <a href="/privacy">Privacidade</a>
            <a href="/terms">Termos</a>
            <a href="/data-deletion">Eliminação de dados</a>
          </nav>
        </footer>
      </body>
    </html>
  );
}
