# مسار

منصة دراسة التمويل وإدارة صفقات السداد وإعادة التمويل. هذا الفرع (`revamp`) هو إعادة البناء الكاملة: باك اند وواجهة جديدان، والموقع الحي يبقى على `main` حتى يُعتمد التحويل.

```
npm install
npm run check      # typecheck + tests
npm run dev
```

Without `MASAR_DATABASE_URL` the app runs in demo mode: an in-memory database with fictional deals, nothing to set up. Preview deployments of this branch run the same way.

With a database, people sign in. Two variables are needed, and the first account is made from the terminal:

```
MASAR_DATABASE_URL=postgres://...   # the rebuild's own database
MASAR_SECRET=...                    # at least 16 characters; seals authenticator secrets

npm run db:migrate
npm run user:create -- --name "..." --email someone@example.com --role admin
```

The password is asked for on the terminal and never echoed.

Built on Next.js 16 (App Router), React 19, Drizzle and Postgres, on Node 22.

The layout of the code, the rules it follows and the porting checklist are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
