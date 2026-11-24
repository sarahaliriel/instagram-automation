# Arquitetura

A aplicação principal é um monólito modular Next.js. `src/app` contém páginas e adaptadores HTTP; `src/modules/automations` valida regras e faz correspondência determinística sem dependências de infraestrutura. `src/modules/webhooks` verifica assinatura HMAC sobre o corpo original, valida payloads e limita o tamanho do pedido. `src/modules/instagram` contém o cliente Meta limitado a desenvolvimento.

`src/server/db` usa Prisma e PostgreSQL para persistência, dados cifrados e relações sujeitas a restrições. A receção de comentários e o outbox são gravados antes da confirmação. `src/server/jobs` implementa despacho e processamento local através do Inngest. `src/server/delivery` separa estados e tentativas; resultados incertos não devem ser tratados como entrega comprovada. Estes controlos não são prova de prontidão para uso real.

O dashboard usa HTTP Basic no proxy. As Server Actions de escrita verificam novamente as credenciais e a origem. É uma proteção administrativa mínima, não um sistema multiutilizador completo. A integração Instagram, os jobs e a entrega estão bloqueados em produção; não contornar esses bloqueios.

`legal-site` produz uma exportação estática com quatro páginas. O seu build copia apenas uma lista fechada de fontes legais da aplicação principal e audita o artefacto; não executa o backend no deployment estático.
