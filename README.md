# مسار

منصة دراسة التمويل وإدارة صفقات السداد وإعادة التمويل. هذا الفرع (`revamp`) هو إعادة البناء الكاملة: باك اند وواجهة جديدان، والموقع الحي يبقى على `main` حتى يُعتمد التحويل.

```
npm install
npm run check      # typecheck + tests
npm run dev
```

Without `MASAR_DATABASE_URL` the app runs in demo mode: an in-memory database with fictional deals, nothing to set up. Preview deployments of this branch run the same way.

With a database, people sign in. Two variables are needed, a third switches passkeys on, and the first account is made from the terminal:

```
MASAR_DATABASE_URL=postgres://...   # the rebuild's own database
MASAR_SECRET=...                    # at least 16 characters; seals authenticator secrets
MASAR_ORIGINS=https://masarfin.com,https://www.masarfin.com   # the site's exact addresses, its own first; without it there are no passkeys

npm run db:migrate
npm run user:create -- --name "..." --email someone@example.com --role admin
```

The password is asked for on the terminal and never echoed.

On Vercel none of this is typed: a production build applies the migrations itself and will not go live without those three variables or without an account. The old system's data, accounts included, comes over as a step of the first production deployment. The steps, the rehearsal and the way back are in [docs/MIGRATION.md](docs/MIGRATION.md).

Tests run on an in-process Postgres. To run them on a Postgres server through the driver the live site uses: `MASAR_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test`.

Built on Next.js 16 (App Router), React 19, Drizzle and Postgres, on Node 22.

The layout of the code, the rules it follows and the porting checklist are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
