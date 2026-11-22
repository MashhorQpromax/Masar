# Masar v2 architecture

Masar runs a financing brokerage whose core business is the "settle and refinance" deal: the company pays a client's enforcement orders, defaults and mortgage payoff, holds the property as security, and recovers its capital plus a fee from the client's new bank financing. The numbers are real money, so correctness comes before everything else.

This branch is a rebuild from zero. The live site stays on `main` and its database is not touched from here.

## Layout

```
src/
  domain/      Pure business rules. No database, no clock, no network, no text in any language.
    shared/    Rounding and small numeric helpers.
    finance/   SAMA constants and loan math (installments, principal, payoff, pension).
    deal/      The settle-and-refinance engine: structures, study, risks, ledger, alternatives,
               the six stations of the road, portfolio totals, where the new financing goes,
               and the borrower facts a deal is computed from.
  copy/        Arabic wording for every code the domain returns, the choices a form offers,
               and number, date and count formatting.
  server/      Everything that touches the outside world (database, auth, WhatsApp). Server only.
    db/        Drizzle schema (one file per area) and the connection.
    deals/     Deal service: validate, compute with the engine, store, move stages, audit. Read views for screens.
               A new client's first deal and a revision of a deal's numbers are each one transaction.
    clients/   Client files: the facts a deal is computed from, and file numbering.
    auth/      Who is acting. Every route and action asks here first.
    demo/      Fictional deals for a build that has no database.
  app/         Next.js routes. Thin: read through services, render, call server actions.
  ui/          Design system for the "الخريطة" identity: the road, tiles, dock, figures, form fields.
db/migrations/ Versioned SQL migrations. The only way the schema changes.
tests/
  domain/      Unit tests and golden tests for the engines.
  golden/      Frozen answers of the engines that ran in production before the rebuild.
legacy/        The old application, parked as a read-only reference. Deleted before launch.
```

## Rules

1. **Domain code is pure.** A function in `src/domain` takes data and returns data. It never reads the database or the time, and it never returns display text. It returns codes and numbers (`{ code: "DEFICIT", params: { deficit: 65000 } }`); the interface owns the wording.
2. **The numbers are locked.** Every engine ported from the old system must reproduce the old answers to the riyal on the cases in `tests/golden`. A change to a rule is made on purpose, in its own commit, together with the regenerated or edited fixture.
3. **Rounding is explicit.** Each named money quantity is rounded to whole riyals with `round0` at the point it is defined. Percentages shown to people carry one decimal, cover ratios two.
4. **Validate at the edge.** Every server action parses its input with a zod schema before any work. Domain functions receive typed, validated data only.
5. **One way to write.** Writes go through a service function that runs in a transaction and records an audit row. Routes and actions never issue SQL.
6. **Client-facing output cannot leak fees.** Anything sent to a client (portal, WhatsApp) is built from client view types that have no fee, profit or capital fields.
7. **Schema changes are migrations.** No schema is created or altered at runtime.
8. **No secrets in the repository.** Configuration comes from environment variables.
9. **Its own database, by name.** All tables live in the Postgres schema `masar`, and the app reads only `MASAR_DATABASE_URL`. It never falls back to `DATABASE_URL` or `POSTGRES_URL`, so a preview of this branch cannot attach to the live data by accident.
10. **No database means demo, never production.** Without `MASAR_DATABASE_URL` the app runs on an in-memory Postgres filled with fictional deals, shows a "بيانات تجريبية" mark, and refuses to start when `VERCEL_ENV` is `production`. With a database, every route fails closed until sign-in is ported: `requireActor` throws.
11. **Wording for the domain lives in one place.** Every code the domain returns (a verdict, a risk, a ledger line, an obligation kind, a refusal) gets its Arabic text from `src/copy`, and a test fails when one has none. A screen may hold its own headings and field labels. Numbers inside Arabic sentences are wrapped in direction isolates; negative amounts take a true minus sign.
12. **The browser shows, the server decides.** The deal editor runs the same pure engine in the browser to show the result while a person types. Saving sends the inputs only; the service validates them, computes again and stores its own answer.

## The road

The home screen is a road with six stations. Each of the eleven stages belongs to one station: study (study, agreement), settle (settlement, clearance), credit (credit record update), property (payoff, transfer), bank (submission, approval), payout (disbursement, recovery). A deal without a property skips the property station.

- `stationOf`, `stationsFor`, `stationTimeline`: where a deal stands and when it reached or should reach each station.
- `portfolio`: capital out, fees expected from deals that close, capital returning within 30 days, the deal nearest to disbursement and the stage deadline that comes first.
- `fundsFlow`: the new financing split into capital recovered, loan bought out by the bank, fee, costs and what the client keeps. It adds up exactly on all 240 golden cases.

## The deal editor

One screen opens a client's file with their first deal (`/deals/new`) and revises the numbers of a deal in progress (`/deals/[id]/edit`). The numbers of a closed or lost deal are a record and cannot be edited. The result panel follows the form and recomputes on every keystroke; an empty optional amount means "not known" and is never stored as zero. A birth year between 1300 and 1500 is read as Hijri and converted. On a phone the fields go two a row, the riyal unit steps aside for the digits, and a bar at the bottom carries the result and the save button. `tests/server/open-deal.test.ts` and `tests/server/input.test.ts` cover what is stored and what is refused.

## Deal engine

`dealStudy(input, borrower, credit)` returns one `DealStudy`:

- capital the company puts in (`paidByCompany`, taxes, fixed costs, `capital`)
- the financing the client can expect (`financing`), from the bank's offer when there is one, otherwise estimated from salary under SAMA caps
- fees (`feeSettle`, `feeFinance`, `feeFixed`, `fee`) and the fee suggested for the client's risk
- the result (`dueFromClient`, `clientNet`, `verdict`)
- `risks` as codes with levels, `ledger` as the step by step calculation, `summary` for a compact view

`dealAlternatives` proposes ways to close a deal that is short: another structure, a settlement discount, a lower fee, a higher valuation, a co-borrower.

Item labels use the pattern `title — party`. The long dash is a separator the code splits on (`src/domain/deal/labels.ts`).

## Porting checklist

Old module (under `legacy/lib`) and its state in the rebuild:

- [x] `deal.ts` study, structures, fees, alternatives: `src/domain/deal`, locked by `tests/golden/deal.json` (240 cases)
- [x] loan math and SAMA constants from `engine.ts`: `src/domain/finance`
- [ ] `deal.ts` `itemsFrom` (deal items from a credit report): moves with the credit module
- [ ] `engine.ts` eligibility, lender matching, required documents
- [ ] `simah.ts`, `simah-parse.ts` credit report grading and PDF parsing
- [ ] `project.ts` project finance
- [ ] `advisor.ts`
- [ ] `whatsapp.ts`, `wa-cloud.ts` messages and Meta Cloud API
- [ ] `auth.ts`, `auth-methods.ts`, `totp.ts` sign-in: password, passkey, authenticator, WhatsApp code
- [x] `schema.ts`, `db.ts`: replaced by `src/server/db` (Drizzle schema, `db/migrations`, Postgres schema `masar`)
- [x] deal storage and stages from `data.ts` and `actions.ts`: `src/server/deals` (save, stage, reject, reopen, read), tested on a real Postgres engine in memory
- [ ] the rest of `data.ts` and `actions.ts`: clients, credit, lenders, documents, notes
- [x] screens on the "الخريطة" direction: the road (home), the deals list, the deal file with stage moves and the step by step calculation, the deal editor
- [x] opening a client file and revising its facts, from `data.ts` and `actions.ts`: `src/server/clients`
- [ ] screens still to build: clients, credit, lenders, inbox, calculator, knowledge, users, audit, account, client portal
- [ ] data migration from the live database, then the domain switch (only after the owner approves)

To regenerate a golden file while `legacy/` still exists: `npm run golden:deal`.
