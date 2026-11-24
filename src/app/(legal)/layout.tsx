import type { ReactNode } from "react";
import styles from "./legal.module.css";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className={styles.main}>
      {children}
    </main>
  );
}
