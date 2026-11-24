import type { Metadata } from "next";
import { LegalPage } from "../legal-page";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Política de privacidade | GT Projeto — Instagram Automation",
  description:
    "Como a ferramenta do GT Projeto trata dados de comentários do Instagram, quais as medidas de segurança e o que falta confirmar antes da publicação.",
  robots: { index: false, follow: false },
};

const sections = [
  { id: "responsavel", label: "Responsável e âmbito" },
  { id: "dados", label: "Dados tratados" },
  { id: "origem", label: "Origem e finalidades" },
  { id: "fundamento", label: "Fundamento jurídico" },
  { id: "seguranca", label: "Armazenamento e segurança" },
  { id: "prestadores", label: "Prestadores e transferências" },
  { id: "conservacao", label: "Conservação e eliminação" },
  { id: "direitos", label: "Direitos e contacto" },
  { id: "alteracoes", label: "Alterações" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de privacidade"
      lead="Informação sobre os dados associados à gestão de comentários da conta profissional autorizada. Esta versão descreve a implementação atual e identifica decisões ainda necessárias antes da publicação."
      sections={sections}
    >
      <section id="responsavel" aria-labelledby="responsavel-title">
        <h2 id="responsavel-title">Responsável e âmbito</h2>
        <p>
          GT Projeto — Instagram Automation é uma ferramenta administrativa
          privada para gerir interações autorizadas de uma conta profissional. O
          nome técnico da aplicação na Meta é <em>automation</em>. Não é uma
          aplicação oficial da Meta ou do Instagram.
        </p>
        <p>
          A aplicação é desenvolvida e mantida por Sarah Aliriel Dumitrache para
          uma única conta de Instagram operada por Maria Dumitrache; não é
          atualmente um serviço SaaS público. Maria é a responsável pelo
          tratamento dessas interações e determina as finalidades, as interações
          tratadas e as respostas configuradas. Sarah é autora e responsável
          técnica e poderá ser subcontratante quando tratar dados sob instruções
          documentadas. A autoria não determina, por si só, o papel na proteção
          de dados.
        </p>
        <p className={styles.note}>
          O contacto autorizado para pedidos de privacidade e eliminação de
          dados é{" "}
          <a href="mailto:dumitrachebusiness@gmail.com">
            dumitrachebusiness@gmail.com
          </a>
          . O procedimento operacional de resposta continua em revisão.
        </p>
      </section>
      <section id="dados" aria-labelledby="dados-title">
        <h2 id="dados-title">Dados tratados</h2>
        <p>
          Quando a receção de webhooks estiver ativada, a aplicação poderá
          guardar o identificador da conta profissional, da publicação e do
          comentário, a hora da notificação e o texto do comentário cifrado. Um
          recibo e uma fila interna registam o estado da receção. Se forem
          ativadas regras de correspondência, poderão existir estados de
          processamento e uma intenção de resposta cifrada.
        </p>
        <p>
          O sistema dispõe de um registo técnico de tentativas de entrega para
          testes controlados. Pode conter estados, códigos de erro limitados e
          identificadores de operações cifrados. O envio real de mensagens e a
          resposta pública de fallback estão desativados na operação atual.
        </p>
        <p>
          O identificador do autor pode ser lido durante a validação de um
          webhook, mas não é guardado na tabela de comentários. O nome de
          utilizador e o corpo bruto do webhook também não são guardados nessa
          tabela. Os comentários públicos podem, ainda assim, conter dados
          pessoais escritos pelos próprios autores.
        </p>
      </section>
      <section id="origem" aria-labelledby="origem-title">
        <h2 id="origem-title">Origem e finalidades</h2>
        <p>
          Os dados chegam da Instagram API da Meta, após autorização da conta
          profissional e ativação específica dos webhooks. A aplicação usa a
          Instagram API with Unified Login para verificar a conta autorizada e,
          se ativada, receber notificações de comentários. Estas páginas não
          incluem formulários nem ferramentas de análise de visitas. O
          alojamento poderá tratar dados técnicos, como endereços IP e registos
          de acesso; essas práticas e os prestadores efetivos devem ser
          confirmados antes da publicação.
        </p>
        <p>
          A finalidade técnica é registar comentários recebidos, evitar
          processamento duplicado e permitir a gestão administrativa de regras e
          interações autorizadas da conta. O processamento automático e as
          respostas dependem de ativações separadas; a verificação do callback
          HTTPS, por si só, não os ativa.
        </p>
      </section>
      <section id="fundamento" aria-labelledby="fundamento-title">
        <h2 id="fundamento-title">Fundamento jurídico</h2>
        <p className={styles.note}>
          O fundamento jurídico aplicável a cada finalidade ainda não foi
          determinado pelo responsável. A autorização de acesso à API pela conta
          profissional não substitui essa análise. O fundamento será indicado
          nesta página antes da publicação.
        </p>
      </section>
      <section id="seguranca" aria-labelledby="seguranca-title">
        <h2 id="seguranca-title">Armazenamento e segurança</h2>
        <p>
          A implementação prevê a gravação de dados estruturados em PostgreSQL e
          a cifragem do texto dos comentários, modelos de resposta e certas
          intenções e identificadores de operação com AES-256-GCM. A chave é
          fornecida ao processo separadamente da base de dados. Na receção de
          webhooks em desenvolvimento, a assinatura HMAC-SHA256 é verificada
          antes do processamento e a aceitação dos comentários suportados só é
          confirmada após a gravação durável. A receção e o processamento
          alojado ainda não estão ativados em produção.
        </p>
        <p>
          As credenciais podem ser fornecidas através de configuração privada e
          não são guardadas nas tabelas de comentários. A configuração de
          alojamento, acessos, monitorização e prestadores ainda requer revisão.
          Estas medidas não constituem uma garantia absoluta de segurança.
        </p>
      </section>
      <section id="prestadores" aria-labelledby="prestadores-title">
        <h2 id="prestadores-title">Prestadores e transferências</h2>
        <p>
          A Meta fornece a API do Instagram. Os prestadores efetivos do site e
          da aplicação, os serviços que executam e os seus papéis no tratamento
          devem ser identificados e avaliados antes da publicação definitiva.
        </p>
        <p className={styles.note}>
          Antes da publicação, o responsável deverá confirmar os prestadores
          efetivos, as respetivas localizações, contratos e eventuais
          transferências internacionais. Esta versão não afirma uma localização
          única para todos os dados.
        </p>
      </section>
      <section id="conservacao" aria-labelledby="conservacao-title">
        <h2 id="conservacao-title">Conservação e eliminação</h2>
        <p>
          Não existe ainda um prazo de conservação aprovado nem uma rotina
          automática de eliminação dos comentários e respetivos registos. As
          relações entre comentários, recibos, fila e histórico exigem um
          procedimento de eliminação cuidadoso. Não prometemos uma eliminação
          automática ou um prazo que a aplicação ainda não consegue cumprir.
        </p>
        <p>
          A política de conservação, cópias de segurança, eliminação e eventual
          necessidade de preservar evidência mínima contra duplicados terá de
          ser definida antes do tratamento regular de comentários reais. Ver a
          <a href="/data-deletion"> página de eliminação de dados</a>.
        </p>
      </section>
      <section id="direitos" aria-labelledby="direitos-title">
        <h2 id="direitos-title">Direitos e contacto</h2>
        <p>
          As pessoas podem pedir informação sobre o tratamento dos seus dados e,
          quando aplicável, acesso, retificação, apagamento, limitação ou
          oposição. Cada pedido requer análise da identidade e do contexto, com
          recolha mínima de dados. Também é possível apresentar uma reclamação à
          autoridade de controlo competente.
        </p>
        <p className={styles.note}>
          O contacto prioritário autorizado para pedidos relativos a dados
          pessoais é{" "}
          <a href="mailto:dumitrachebusiness@gmail.com">
            dumitrachebusiness@gmail.com
          </a>
          . O procedimento de resposta ainda requer validação antes da
          publicação desta política.
        </p>
      </section>
      <section id="alteracoes" aria-labelledby="alteracoes-title">
        <h2 id="alteracoes-title">Alterações</h2>
        <p>
          Esta versão de trabalho foi atualizada em 23 de novembro de 2026.
          Qualquer versão publicada deverá indicar a data de entrada em vigor e
          refletir alterações relevantes às práticas, prestadores e contactos.
        </p>
      </section>
    </LegalPage>
  );
}
