import type { Metadata } from "next";
import { LegalPage } from "../legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Eliminação de dados | GT Projeto — Instagram Automation",
  description:
    "Informação sobre pedidos de eliminação de dados associados a comentários do Instagram e o procedimento manual ainda por validar.",
  robots: { index: false, follow: false },
};

const sections = [
  { id: "pedir", label: "Como apresentar um pedido" },
  { id: "abrangidos", label: "Dados abrangidos" },
  { id: "analise", label: "Análise e confirmação" },
  { id: "identidade", label: "Verificação de identidade" },
  { id: "limites", label: "Limites e conservação" },
  { id: "estado", label: "Estado do procedimento" },
];

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Eliminação de dados"
      lead="Explicamos que dados podem estar associados a um comentário e como deverá ser tratado um pedido de apagamento. O processo operacional ainda exige validação antes da publicação."
      sections={sections}
    >
      <section id="pedir" aria-labelledby="pedir-title">
        <h2 id="pedir-title">Como apresentar um pedido</h2>
        <p>
          O contacto autorizado para pedidos de eliminação de dados é{" "}
          <a href="mailto:dumitrachebusiness@gmail.com">
            dumitrachebusiness@gmail.com
          </a>
          . Maria Dumitrache, operadora da conta, é a responsável pelo
          tratamento dessas interações. O procedimento de atendimento ainda deve
          ser validado. Indique apenas a informação necessária para localizar o
          comentário; não envie palavras-passe, tokens ou documentos pessoais
          por iniciativa própria. Esta página não inclui um botão de eliminação
          automática nem um formulário de recolha de dados.
        </p>
      </section>
      <section id="abrangidos" aria-labelledby="abrangidos-title">
        <h2 id="abrangidos-title">Dados abrangidos</h2>
        <p>
          Um pedido pode dizer respeito ao identificador e texto cifrado de um
          comentário recebido da Meta, à referência à publicação e à conta
          profissional, ao recibo do webhook e aos estados de processamento. Se
          tiverem sido criados numa fase posterior, poderão existir também uma
          intenção de resposta cifrada e registos técnicos de tentativas de
          entrega. O nome de utilizador do autor não é guardado na tabela de
          comentários.
        </p>
        <p>
          A eliminação nesta aplicação não apaga automaticamente o comentário
          visível no Instagram. Para gerir o conteúdo na plataforma, devem ser
          usados os mecanismos disponibilizados pela Meta e pelo titular da
          conta, conforme aplicável.
        </p>
      </section>
      <section id="analise" aria-labelledby="analise-title">
        <h2 id="analise-title">Análise e confirmação</h2>
        <p>
          A entidade responsável deverá registar o pedido de forma segura,
          localizar os dados relevantes, avaliar o âmbito e comunicar a decisão
          ao titular. A eliminação técnica terá de abranger as relações entre
          comentário, recibo, fila, histórico e eventuais registos de entrega,
          sem deixar referências órfãs nem criar novas tentativas de envio.
        </p>
        <p className={styles.note}>
          Existe uma rotina experimental de apagamento restrita a uma base de
          dados de teste isolada; não é um mecanismo de eliminação em produção.
          Não existe uma ferramenta de exportação para titulares nem um prazo de
          conservação aprovado. O procedimento de produção ainda tem de ser
          concebido e validado; não se deve confirmar um apagamento sem
          verificar a sua execução e alcance.
        </p>
      </section>
      <section id="identidade" aria-labelledby="identidade-title">
        <h2 id="identidade-title">Verificação de identidade</h2>
        <p>
          Para evitar divulgar ou eliminar dados de outra pessoa, a entidade
          responsável deverá confirmar a relação entre o requerente e os dados
          pedidos com a menor informação possível. Um identificador do
          comentário ou um link para o comentário pode ajudar a localizar o
          registo; não deve ser exigido o envio de passwords, tokens ou cópias
          de documentos por defeito. Se houver dúvida razoável, a necessidade de
          elementos adicionais deverá ser avaliada caso a caso.
        </p>
      </section>
      <section id="limites" aria-labelledby="limites-title">
        <h2 id="limites-title">Limites e conservação</h2>
        <p>
          O pedido será apreciado segundo as regras aplicáveis. Poderá ser
          necessário conservar determinados dados quando exista uma obrigação
          legal ou outra razão válida, a identificar caso a caso. Não há, neste
          momento, uma lista de exceções ou prazos já aprovados para esta
          aplicação. Qualquer recusa ou conservação parcial deverá ser explicada
          ao requerente.
        </p>
      </section>
      <section id="estado" aria-labelledby="estado-title">
        <h2 id="estado-title">Estado do procedimento</h2>
        <p>
          Esta página é uma versão de trabalho, atualizada em 23 de novembro de
          2026. O procedimento operacional de eliminação ainda tem de ser
          validado antes da publicação. Consultar também a{" "}
          <a href="/privacy">política de privacidade</a>.
        </p>
      </section>
    </LegalPage>
  );
}
