# Site legal

Aplicação estática independente do runtime do backend. O build copia uma lista fechada de fontes de `../src/app`, gera quatro páginas e audita o conteúdo de `static-out/`. Os textos são versões de trabalho e exigem revisão jurídica e operacional antes da publicação.

Com Node.js 24, execute `npm ci`, `npm run build`, `npm run typecheck` e `npm test` nesta pasta. Não forneça credenciais nem ficheiros `.env` ao build. As únicas exceções ao filtro de nomes são `VERCEL_OIDC_TOKEN` e `VERCEL_ARTIFACTS_TOKEN`, variáveis da plataforma Vercel; não são passadas ao processo Next.js nem necessárias ao site. O artefacto contém apenas HTML e CSS; verifique-o antes de qualquer publicação.

Para Vercel, selecione `legal-site` como Root Directory e permita acesso aos ficheiros de origem fora desse diretório. `vercel.json` configura o build e `static-out` como output. Verifique num preview a compatibilidade com variáveis automáticas da plataforma, HTTPS, conteúdo público, acessibilidade e ausência das rotas do backend. Não associe segredos do backend. Consultar [deployment](../docs/deployment.md).
