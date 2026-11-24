import type { ReactNode } from "react";
import { DashboardNav } from "./dashboard-nav";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="brand-mark" aria-hidden="true">
            GT
          </span>
          <span>
            <strong>GT Projeto</strong>
            <small>Automation studio</small>
          </span>
        </div>
        <DashboardNav />
        <div className="sidebar-foot">
          <span className="status-light" aria-hidden="true" />
          <span>
            <strong>Ambiente privado</strong>
            <small>Leitura segura</small>
          </span>
        </div>
      </aside>
      <header className="dashboard-mobile-header">
        <div className="dashboard-brand">
          <span className="brand-mark" aria-hidden="true">
            GT
          </span>
          <strong>GT Projeto</strong>
        </div>
        <details>
          <summary aria-label="Abrir navegação">Menu</summary>
          <DashboardNav />
        </details>
      </header>
      <main id="main" className="dashboard-main">
        {children}
      </main>
    </div>
  );
}
