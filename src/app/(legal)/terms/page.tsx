import type { Metadata } from "next";
import { LegalPage } from "../legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Termos de utilização | GT Projeto — Instagram Automation",
  description:
    "Condições de utilização da ferramenta administrativa privada do GT Projeto para interações autorizadas no Instagram.",
  robots: { index: false, follow: false },
};

const sections = [
  { id: "natureza", label: "Natureza da ferramenta" },
  { id: "acesso", label: "Acesso e utilização" },
  { id: "funcionalidades", label: "Funcionalidades" },
  { id: "responsabilidades", label: "Responsabilidades" },
  { id: "propriedade", label: "Propriedade intelectual" },
  { id: "alteracoes", label: "Alterações e contacto" },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de utilização"
      lead="O GT Projeto — Instagram Automation é uma ferramenta privada de apoio à gestão da conta profissional autorizada. Estes termos descrevem o seu âmbito atual, sem criar uma oferta pública de serviços."
      sections={sections}
    >
      <section id="natureza" aria-labelledby="natureza-title">
        <h2 id="natureza-title">Natureza da ferramenta</h2>
        <p>
          A aplicação destina-se à conta de Instagram operada por Maria
          Dumitrache. É desenvolvida e mantida por Sarah Aliriel Dumitrache e
          não é atualmente um serviço SaaS público. O seu nome técnico na Meta é{" "}
          <em>automation</em>. A ferramenta não é um produto oficial da Meta nem
          do Instagram, e a disponibilização destas páginas não concede acesso
          ao painel administrativo.
        </p>
        <p>
          Sarah é a autora do software e a responsável técnica. Maria é a
          responsável pelo tratamento das interações da conta e determina as
          finalidades, as interações tratadas e as respostas configuradas. Sarah
          poderá ser subcontratante ao tratar dados sob instruções documentadas;
          esse papel depende das atividades efetivas.
        </p>
      </section>
      <section id="acesso" aria-labelledby="acesso-title">
        <h2 id="acesso-title">Acesso e utilização</h2>
        <p>
          O uso da aplicação deve limitar-se à conta profissional e aos dados
          para os quais exista autorização. Os operadores devem proteger as
          credenciais, respeitar as permissões concedidas pela Meta e não usar a
          ferramenta para aceder a contas ou comentários fora do âmbito
          autorizado. O acesso administrativo e a autenticação de operadores
          ainda não constituem uma funcionalidade pública desta versão.
        </p>
      </section>
      <section id="funcionalidades" aria-labelledby="funcionalidades-title">
        <h2 id="funcionalidades-title">Funcionalidades disponíveis</h2>
        <p>
          A implementação de desenvolvimento inclui verificação de webhooks,
          ingestão durável de comentários, regras de correspondência e registos
          de processamento e de tentativas de entrega para testes controlados. A
          receção de webhooks e o processamento alojado não estão ativados em
          produção. O envio real de mensagens privadas está desativado na
          operação atual; a resposta pública de fallback também está desativada.
          As subscrições de webhooks e a publicação da app Meta exigem decisões
          separadas.
        </p>
        <p>
          O serviço da Meta pode impor requisitos de acesso, disponibilidade e
          revisão próprios. Uma verificação bem-sucedida do callback HTTPS não
          garante a receção de comentários reais nem autoriza respostas
          automáticas.
        </p>
      </section>
      <section id="responsabilidades" aria-labelledby="responsabilidades-title">
        <h2 id="responsabilidades-title">Responsabilidades da responsável</h2>
        <p>
          A entidade responsável pela operação deve manter a autorização da
          conta, rever as regras antes da ativação, proteger os dados e
          credenciais, acompanhar erros de entrega e responder aos pedidos
          relativos a dados pessoais. A ativação de qualquer envio real exige
          validação própria do destinatário, da mensagem e das permissões
          aplicáveis.
        </p>
        <p className={styles.note}>
          As condições contratuais eventualmente aplicáveis ainda não foram
          confirmadas. Estes termos devem ser revistos antes de publicação.
        </p>
      </section>
      <section id="propriedade" aria-labelledby="propriedade-title">
        <h2 id="propriedade-title">Propriedade intelectual</h2>
        <p>
          O nome e os conteúdos próprios do GT Projeto são apresentados para
          identificar a ferramenta. Instagram e Meta são marcas dos seus
          respetivos titulares. Estes termos não transferem direitos de
          propriedade intelectual nem autorizam a reutilização das marcas de
          terceiros.
        </p>
      </section>
      <section id="alteracoes" aria-labelledby="alteracoes-title">
        <h2 id="alteracoes-title">Alterações e contacto</h2>
        <p>
          Esta versão de trabalho foi atualizada em 23 de novembro de 2026.
          Alterações materiais à ferramenta ou às condições de utilização
          deverão ser refletidas numa versão datada. O contacto oficial é{" "}
          <a href="mailto:dumitrachebusiness@gmail.com">
            dumitrachebusiness@gmail.com
          </a>
          . Para informação sobre dados pessoais, consultar a{" "}
          <a href="/privacy">política de privacidade</a>.
        </p>
      </section>
    </LegalPage>
  );
}
