# ShareTab — private Cloudflare Worker

ShareTab tracks shared expenses, balances, settlements, and receipt splits. This branch is a single-operator app for Cloudflare Workers. It has no in-app sign-in, registration, or request rate limits. **Cloudflare Access must protect the entire Worker before any public route is enabled.** Anyone admitted by its Access policy can read and change all app data.

The app uses vinext (Next.js 16 API on Workers), Prisma with Cloudflare D1, a private R2 bucket for receipt images, and the OpenAI API for optional receipt scanning. Other people in a group are participant records, not login accounts. Guest/claim links remain usable only by someone admitted through the same Access policy; they are not public sharing links.

## Local development

Requires Node.js 22+ and pnpm 12 (`packageManager` in `package.json`; Corepack or a global `pnpm` install). From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm run db:migrate:local
cp .env.example .dev.vars
pnpm run dev
```

Set `OPENAI_API_KEY` in `.dev.vars` to scan real receipts. For local fixture extraction only, set `AI_PROVIDER_PRIORITY=mock`. `pnpm run dev` builds and runs the Worker locally with D1/R2 simulations. Local state lives under `.wrangler/state` and is not committed. This production-shaped local path has no hot reload: stop it, run `pnpm run build`, then `pnpm run start` after source edits. The direct `vinext dev` path currently fails Prisma/D1 calls in Vite's development runtime, so it is not the default.

The app creates its one operator row on the first request. `OWNER_EMAIL` in `wrangler.jsonc` is display/record identity, not an authentication check; set it before first use and keep it stable. The profile name can be edited in Settings. New groups add that operator as owner; add people to split with under group Settings.

## Cloudflare setup and deployment

1. Create a D1 database named `sharetab` (`pnpm exec wrangler d1 create sharetab`). Replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID. Create a private R2 bucket named `sharetab-receipts` (`pnpm exec wrangler r2 bucket create sharetab-receipts`). Do not attach a public bucket hostname.
2. Run `pnpm exec wrangler d1 migrations apply sharetab --remote` against that **new, empty** D1 database. The checked-in migrations are the schema and a write guard for atomic D1 batches; PostgreSQL data is not imported.
3. Build and deploy with `pnpm run build` and `pnpm run deploy:vinext`. The checked-in config has `workers_dev: false`, `preview_urls: false`, and no route, so this first deployment is not a public app URL. Do not add a route until Access is configured.
4. In Workers & Pages → this Worker → Access, choose **All traffic** and an Allow policy for your exact identity (not an entire email domain). This Worker-level rule covers custom domains, routes, `workers.dev`, and previews if any are later enabled. Add `OPENAI_API_KEY` as a Worker secret if scanning is needed (`pnpm exec wrangler secret put OPENAI_API_KEY`); set `OPENAI_MODEL` as a non-secret variable if desired.
5. Add a custom domain/route to the Worker. From a signed-out browser, verify the root page, `/api/trpc/profile.getOperator`, `/api/upload`, `/api/uploads/...`, and `/api/admin/export` are blocked by Access; then sign in and test the app. No API or media route may bypass the Worker-level policy.

The [Cloudflare Access Worker guide](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) describes the All traffic policy. If you use only a hostname policy instead, you must separately protect every alternative route and preview. The Access logout link in the app points to `/cdn-cgi/access/logout`.

`wrangler.jsonc` contains placeholder D1 metadata, not a real Cloudflare resource. This repository does not create resources, set Access policy, apply remote migrations, or deploy automatically. Keep secrets in `.dev.vars` locally and in Worker secrets remotely; do not commit them.

## Data and operational notes

- D1 holds expenses, shares, participants, receipts metadata, and quick-split sessions. Monetary amounts are integer cents. Financial multi-row writes use atomic D1 batches; quick-split edits use a revision check. Never substitute Prisma's D1 `$transaction` for these operations: its adapter does not provide the expected transaction guarantee.
- Receipt images are private R2 objects, served only through `/api/uploads/...` after a matching D1 receipt lookup. Uploads retain a 10 MiB cap and MIME/magic-byte checks. Access protects both the API and media path.
- `/api/admin/export` exports database metadata only; back up the R2 bucket separately. D1 has managed backup/time-travel features, but test restores before relying on them.
- No application login, password, invitations, SMTP, or per-app rate limits remain. Input validation, same-origin write checks, and database constraints remain because they protect data correctness even for a private app.
- The previous Docker/PostgreSQL and account-based Playwright scenarios are not applicable to this branch. The unit suite and a local Worker smoke pass cover the new runtime; browser flows should be re-tested before production use.

## Checks

```bash
pnpm exec prisma validate
pnpm exec prisma generate
pnpm exec tsc --noEmit
pnpm test
pnpm run build
pnpm run start # in a second terminal, after pnpm run db:migrate:local
pnpm run test:worker # local only; creates and cleans up test records
pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json
```

The project is based on the original open-source [ShareTab](https://github.com/sw-carlos-cristobal/sharetab) (MIT license). See [LICENSE](LICENSE) and [CHANGELOG.md](CHANGELOG.md) for upstream history.
