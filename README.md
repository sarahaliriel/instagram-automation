# Instagram Automation

Ferramenta em desenvolvimento para gerir regras e interações autorizadas de uma conta profissional do Instagram. O projeto inclui um dashboard administrativo, validação de webhooks, persistência durável, regras de correspondência e um registo de tentativas de entrega.

**Estado:** a integração Instagram, os jobs e o envio estão desativados em produção. A aplicação não constitui um serviço de mensagens em produção e não há garantia de aprovação pela Meta. O site legal é uma aplicação estática independente do runtime do backend, com textos ainda sujeitos a revisão.

## Requisitos e arranque

- Node.js 24 e npm; PostgreSQL apenas para funcionalidades persistentes.
- `npm ci` instala as dependências e gera o cliente Prisma.
- `npm run dev` inicia a aplicação local. Sem configuração, as integrações permanecem desativadas.
- Para dados persistentes, configuração administrativa e testes, consultar [desenvolvimento](docs/development.md). Nunca usar bases reais nos testes de integração.

Consulte [arquitetura](docs/architecture.md) e [deployment](docs/deployment.md) para conhecer os limites atuais. O projeto não é afiliado à Meta ou ao Instagram.

## Autoria e contacto

Software de Sarah Aliriel Dumitrache · [portfólio](https://sarahaliriel.tech) · [email](mailto:dumitrachebusiness@gmail.com) · +351 914 137 185. Pedidos relativos a dados pessoais devem usar prioritariamente o email. A autoria não determina, por si só, quem é responsável pelo tratamento de dados numa instalação.

O código próprio é distribuído sob [MIT](LICENSE); dependências e marcas de terceiros mantêm as respetivas condições. Consulte os [avisos de terceiros](THIRD_PARTY_NOTICES.md).
