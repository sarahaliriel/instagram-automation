# Desenvolvimento

Use Node.js 24 e `npm ci`. O postinstall gera o cliente Prisma. `npm run dev` inicia Next.js; `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` validam a aplicação. `npm run format:check` verifica formatação.

`.env.example` descreve as variáveis. Use configuração local não versionada e nunca publique credenciais. `APP_URL` é a origem da aplicação; em produção deve ser HTTPS. `ADMIN_USERNAME` e `ADMIN_PASSWORD` protegem o dashboard quando configurados. `DATABASE_URL` e `EVENT_ENCRYPTION_KEY` são necessários para persistência ativa; o valor da chave deve ser gerado e armazenado num gestor de segredos. `DIRECT_DATABASE_URL` é usado pelo CLI de migrations quando definido. A integração, os jobs e a entrega devem permanecer em `disabled` salvo utilização de desenvolvimento explicitamente autorizada.

`compose.yaml` disponibiliza PostgreSQL apenas em loopback e exige `POSTGRES_PASSWORD` fornecida externamente. As migrations não correm no build nem no arranque da aplicação. Faça backup e selecione explicitamente o alvo antes de qualquer migration.

**Testes de integração:** `npm run test:integration` aplica migrations e limpa fixtures. Exige autorização específica e uma base PostgreSQL isolada em loopback cujo nome termina em `_test`; nunca aponte para bases de desenvolvimento ou produção.

Para o site legal: `cd legal-site`, `npm ci`, `npm run build`, `npm run typecheck` e `npm test`. O build usa fontes em `../src/app` e gera `static-out/`; execute-o num ambiente sem segredos. A auditoria integrada verifica a lista de ficheiros permitidos e conteúdo proibido.

A dependency override currently pins `effect` to 3.22.5 to address GHSA-7589-6fvf-x4pw in Prisma's configuration dependency. Prisma pins an older Effect version, so recheck compatibility and remove the override when a supported upstream fix is available.
