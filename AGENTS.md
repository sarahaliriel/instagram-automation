# Repository guide

Inspect the owning module and its colocated tests before changing behavior. Read `docs/architecture.md`, `docs/development.md` and `docs/deployment.md` as relevant. Preserve public interfaces unless explicitly approved.

Keep domain matching free of infrastructure imports. Never weaken webhook HMAC, encryption, idempotency, database constraints, leases, fencing or delivery uncertainty handling. Keep secrets and private payloads server-only and out of logs.

Instagram integration, jobs and delivery are disabled in production by design. Do not enable live subscriptions or messaging without explicit authorization. Integration tests apply migrations and clear fixtures: run them only with explicit approval against a dedicated loopback PostgreSQL database ending in `_test`.

Use the smallest relevant tests first, then applicable lint, typecheck and build checks. Before Next.js changes read the relevant installed documentation in `node_modules/next/dist/docs/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
