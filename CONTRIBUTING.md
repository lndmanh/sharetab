# Contributing to the private Workers branch

This branch targets a single-operator Cloudflare Worker. See [README.md](README.md) for setup and Access deployment order. It does not use PostgreSQL, Docker, or in-app accounts.

## Local setup

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run db:migrate:local
cp .env.example .dev.vars
pnpm run dev
```

`pnpm run dev` builds and runs the Worker on local D1/R2. Rebuild after source edits; the direct Vite hot-reload path currently fails Prisma/D1 calls. Do not commit `.dev.vars`.

## Validation

```bash
pnpm run format:check
pnpm run lint
pnpm exec tsc --noEmit
pnpm test
pnpm run build
pnpm run start # in another terminal
pnpm run test:worker
pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json
```

The Worker smoke test mutates only localhost D1/R2 and cleans its fixtures. The original account-based Playwright suite is historical and not used by this branch's CI. Add new browser coverage for changed flows before enabling a production route.

For schema changes, update `prisma/schema.prisma` and add a numbered SQL migration under `migrations/`; apply locally with `pnpm run db:migrate:local`. Never use `prisma db push` on D1. Prisma's D1 adapter does not provide application transaction semantics: financial multi-row writes must use prepared D1 batches and be tested against the Workers runtime. Preserve integer-cent money amounts and member references.

Do not commit secrets or deploy a Worker route without Worker-level Cloudflare Access set to All traffic. The private R2 receipt bucket must not get a public hostname. Pull requests should explain the change, include focused tests, and pass the checks above.
