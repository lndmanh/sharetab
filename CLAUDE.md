# ShareTab private Worker branch

This branch is a single-operator Cloudflare Workers app. Read README.md for local/deploy steps. The upstream Docker/PostgreSQL/Auth.js instructions do not apply.

## Runtime

- vinext builds the Next.js App Router code for Workers; use `pnpm run dev` (build then local Worker), `pnpm run build`, and `pnpm run start` (built Worker locally). Do not use direct `vinext dev` until its Prisma/D1 Wasm error is resolved.
- D1 binding `env.DB` is the relational database. Prisma 7 uses `@prisma/adapter-d1` in `src/server/db.ts`; create a client per request. `prisma/schema.prisma` uses SQLite, and `migrations/` is applied with Wrangler. Do not run `prisma db push` or PostgreSQL scripts against D1.
- Prisma's D1 adapter does not provide transaction semantics. Multi-row financial/receipt writes use `env.DB.batch()` with prepared statements and the `__WriteGuard` table to ensure a failed precondition rolls back the batch. Quick-split JSON edits use revision-fenced single-row updates. Do not introduce `$transaction` into the Worker code.
- Private R2 binding `env.RECEIPTS` holds receipt images. The D1 row is the authorization/existence source for `/api/uploads/...`; never expose the bucket publicly. Keep image MIME/size validation and handle object/database failure cleanup.
- Cloudflare Access must cover the entire Worker (production and previews) before enabling a route. `src/server/operator.ts` creates an expense identity; it is not an auth gate. All people allowed by Access have full app privileges. Keep same-origin write checks and data validation.
- `OPENAI_API_KEY` is a Worker secret or local `.dev.vars` value; do not put it in `wrangler.jsonc` or commit it. `OWNER_EMAIL` is a non-secret operator record label. No in-app rate limits, OAuth, magic links, or password system exist.

## Checks

Run `pnpm exec prisma validate`, `pnpm exec prisma generate`, `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm run build`, and `pnpm run test:worker` against `pnpm run start`. Use `pnpm run db:migrate:local` with the same `--persist-to` directory as the Worker. `pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json` checks packaging without publishing. Do not run remote deploy or migrations unless requested. Install with `pnpm install --frozen-lockfile` (pnpm 12, see `packageManager`). Do not use npm or `package-lock.json`.

Keep money as integer cents; preserve group/participant references and atomic expense/share updates. Avoid unrelated formatting or generated Prisma edits.
