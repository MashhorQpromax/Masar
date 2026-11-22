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
    credit/    The SIMAH credit record: reading it from the report's text, grading it, and what it
               means for banks and finance companies.
    auth/      The four roles, what each may do, and the rule a new password must meet.
  copy/        Arabic wording for every code the domain returns, the choices a form offers,
               and number, date and count formatting.
  server/      Everything that touches the outside world (database, auth, WhatsApp). Server only.
    db/        Drizzle schema (one file per area) and the connection.
    deals/     Deal service: validate, compute with the engine, store, move stages, audit. Read views for screens.
               A new client's first deal and a revision of a deal's numbers are each one transaction.
    clients/   Client files: the facts a deal is computed from, and file numbering.
    auth/      Who is acting. Every route and action asks here first. Passwords, sessions,
               authenticator codes, one-time codes, passkeys, lockouts, and the accounts themselves.
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
10. **No database means demo, never production.** Without `MASAR_DATABASE_URL` the app runs on an in-memory Postgres filled with fictional deals, shows a "بيانات تجريبية" mark, and refuses to start when `VERCEL_ENV` is `production`. With a database, nothing is read before `requireActor` has found a session: a visitor without one goes to `/login`, and the app refuses to start without `MASAR_SECRET`.
11. **Wording for the domain lives in one place.** Every code the domain returns (a verdict, a risk, a ledger line, an obligation kind, a refusal) gets its Arabic text from `src/copy`, and a test fails when one has none. A screen may hold its own headings and field labels. Numbers inside Arabic sentences are wrapped in direction isolates; negative amounts take a true minus sign.
12. **The browser shows, the server decides.** The deal editor runs the same pure engine in the browser to show the result while a person types. Saving sends the inputs only; the service validates them, computes again and stores its own answer.
13. **Every change names its permission.** A page or an action that changes something, or shows something private, calls `requireActor("deal.edit")` with the permission it needs. The table of who may do what is one object in `src/domain/auth`, frozen by a test. The interface hides what a role cannot do, and the server refuses it regardless.
14. **No secret is stored as it is used.** Passwords are bcrypt hashes. A session cookie holds a random token and the database holds only its SHA-256, so a copy of the database opens no session. Authenticator secrets are sealed with AES-256-GCM under `MASAR_SECRET`; a code sent to a phone is stored as a keyed hash. Nothing typed into the sign-in form is written to the audit log except the email of an account that does not exist.

## The road

The home screen is a road with six stations. Each of the eleven stages belongs to one station: study (study, agreement), settle (settlement, clearance), credit (credit record update), property (payoff, transfer), bank (submission, approval), payout (disbursement, recovery). A deal without a property skips the property station.

- `stationOf`, `stationsFor`, `stationTimeline`: where a deal stands and when it reached or should reach each station.
- `portfolio`: capital out, fees expected from deals that close, capital returning within 30 days, the deal nearest to disbursement and the stage deadline that comes first.
- `fundsFlow`: the new financing split into capital recovered, loan bought out by the bank, fee, costs and what the client keeps. It adds up exactly on all 240 golden cases.

## Sign-in

A person signs in with their email and password, and with the six digits of their authenticator app when the account has one. The same six digits, with the email, also sign in without the password. A passkey signs in with a fingerprint, a face or the device's own lock, and nothing typed. `src/server/auth/signin.ts` and `passkeys.ts` hold every way in, and are tested on a real Postgres engine in memory (`tests/server/signin.test.ts`, `tests/server/account.test.ts`).

- **Sessions** live in the `sessions` table: half a day, or thirty days when the person asks to be remembered. Signing out, stopping an account or changing the password ends them on the server, so a copied cookie stops working. In production the cookie carries the `__Host-` prefix and is never readable by script.
- **A half-way sign-in** (password accepted, code awaited) is a row in `auth_steps` that expires after five minutes and is taken once.
- **Limits.** Five wrong passwords or second-step codes lock the account for fifteen minutes. Twenty failures from one address in fifteen minutes close every way in to that address. Five wrong codes stop sign-in by code alone until a password sign-in. An authenticator code is accepted once.
- **One answer.** A wrong password, an unknown email and a stopped account get the same refusal after the same amount of work.
- **Carried over.** Password hashes and sealed authenticator secrets have the old system's formats, so accounts move across with the data and keep working as long as `MASAR_SECRET` keeps its value.
- **Passkeys** are WebAuthn credentials checked by `@simplewebauthn/server`. The site they belong to comes from `MASAR_ORIGINS`, a list of the exact addresses of the site with its own first (`https://masarfin.com,https://www.masarfin.com`); a production build without it has no passkeys, because taking the address from the request would let a forged host name choose it. The device must have verified its person, a challenge is a row in `auth_steps` answered once, and "remember me" is fixed when the challenge is asked. The tests sign real challenges with a software device (`tests/helpers/authenticator.ts`).
- **The account screen** (`/account`, any role) changes the password, links or stops the authenticator, adds or removes passkeys and signs other devices out. A sign-in method changes only from a session whose person typed the password within the last ten minutes (`requireConfirmed`); a session opened by a code or a passkey is asked for the password first, and wrong passwords there count against the account as they do at the door. The rule lives in the services, so no screen can skip it.
- **Codes over WhatsApp** are issued and checked here (`sendLoginCode`), with limits per person and per address. The sender itself arrives with the WhatsApp module; until then the form does not offer it.
- **The first account** is made with `npm run user:create`. The screen that manages people comes with the remaining screens.

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

## Credit record

`analyzeCredit(report)` grades a SIMAH record from A to E and returns one `CreditAnalysis`:

- `severity` from 0 to 100: every mark adds points, weighted by who the debt is owed to (a finance company default weighs 1.5 times a bank default, a phone bill half)
- `banks` and `financeCompanies`: whether each would take the client today (`open`, `conditional`, `closed`), why, and in how many months a closed door is expected to open
- `blockers`: what no lender accepts while it stands (service suspension, travel ban, open court order, unpaid bounced cheque, unpaid default)
- `stats`, including `totalToClear`: what must be paid before any lender looks at the client. An enforcement order and a default of about the same amount (within 1,500 riyals or 2 percent) are one debt and are counted once
- `findings` and `actions` as codes with their numbers

The weights, waiting periods and thresholds are one object, `CREDIT_RULES`. They are the company's working estimates of how the market reads a record, and they change there and nowhere else.

`parseSimahPages(pages, today)` reads the text of a SIMAH PDF into a `CreditReport` draft, with warnings as codes and a confidence. PDF extraction returns Arabic spelled backwards with numbers glued together, so the reader matches fixed phrases reversed and separates numbers by their fixed shapes. It takes the day as an argument and never reads the clock. An open enforcement order is read as a service suspension until a person confirms or denies it from Absher or Najiz.

`itemDrafts(report, obligations)` in `src/domain/deal` suggests what a new deal has to settle: every open court order, every unpaid default no order already covers, then the client's loans at an estimated payoff. `creditFlags` hands the deal engine the three facts of the record it uses.

### Stored records and the upload

A client's record lives in `credit_reports`. Every reading is kept: the newest is the record, the older ones its history. `src/server/credit/service.ts` writes them (`addCreditReport`, `reviewCreditReport`), in a transaction with an audit entry, and reads them graded as of now (`latestCredit`, `getCredit`). The grade is computed on read, so a change to `CREDIT_RULES` applies to every stored record at once.

The upload (`/clients/[id]/credit`, permission `doc.upload`) takes the PDF as SIMAH issued it, at most 4 MB (`REPORT_MAX_BYTES`, under the platform's request limit), reads its text with `unpdf`, runs the reader and stores the reading. The file itself is read and let go; it is kept once a client's documents are. A reading passes the same schema as any other input (`src/server/credit/input.ts`). One thing is softened there on purpose: an inquiry's amount is only shown, never counted, and extraction often glues it to the number beside it, so an impossible one is stored blank instead of refusing the report.

`unpdf` is pinned to the exact version production runs. The reader depends on how that version lays text out, and `tests/server/pdf.test.ts` reads a made-up report from a real PDF (`tests/fixtures/simah-made-up.pdf`, made by `scripts/make-simah-pdf.cjs`) and expects the production reading. Upgrade the library only with that test green.

SIMAH shows neither a service suspension nor a travel ban. The reading assumes a suspension when an enforcement order is unpaid and marks it as assumed; the credit page then asks one question, answered in one tap after checking Absher or Najiz. A travel ban and a note are set in the manual review. Both go through `reviewCreditReport`, which grades the record again.

A build without a database refuses the upload: it holds invented clients only and is reachable by a shared link, so no real person's report is taken there. The demo carries invented records instead, one per state of the page.

The deal reads the client's newest record (`getDeal`) and hands the engine its three facts, so the deal's notes and its editor say the same thing as the credit page.

Kept as the old system has them and worth a decision before the switch:

- after a settled default the grading keeps banks closed for 12 to 24 months, and the deal shows it as a warning, while the bridge deal goes back to a bank right after settlement. Which banks take a client with a fresh settlement letter belongs with lender matching
- `totalToClear` leaves out an open bounced cheque, and a travel ban or an open cheque alone still reads as a "clean" standing
- a settled telecom default causes no waiting period, and a settlement with no date is read as made just now

Three things differ from the old system on purpose. The analysis no longer writes a guessed creditor back onto the report; it returns the guess, marked as a guess. A bounced cheque is no longer paired with a default of a similar amount, which used to drop that default from the deal's list. A new card in the deal editor defaults to being bought out by the new personal finance, as the old item list already did.

## Porting checklist

Old module (under `legacy/lib`) and its state in the rebuild:

- [x] `deal.ts` study, structures, fees, alternatives: `src/domain/deal`, locked by `tests/golden/deal.json` (240 cases)
- [x] loan math and SAMA constants from `engine.ts`: `src/domain/finance`
- [x] `deal.ts` `itemsFrom` (deal items from a credit report): `itemDrafts` in `src/domain/deal/from-credit.ts`, locked by `tests/golden/credit.json`
- [ ] `engine.ts` eligibility, lender matching, required documents
- [x] `simah.ts` credit grading: `src/domain/credit`, locked by `tests/golden/credit.json` (320 records)
- [x] `simah-parse.ts` reading the report's text: `src/domain/credit/parse.ts`, locked by `tests/golden/simah.json` (160 made-up texts)
- [x] storing a client's credit report, the upload of the PDF, the Najiz check and the credit screen: `src/server/credit`, `/clients/[id]/credit`
- [ ] keeping the uploaded PDF with the client's documents, importing commitments from a report, and suggesting a new deal's items from it in the editor (`itemDrafts` is ready)
- [ ] `project.ts` project finance
- [ ] `advisor.ts`
- [ ] `whatsapp.ts`, `wa-cloud.ts` messages and Meta Cloud API
- [x] `auth.ts`, `totp.ts` sign-in with a password, sessions, roles and permissions, lockouts, the authenticator as a second step and as a code: `src/domain/auth`, `src/server/auth`, the `/login` screen
- [x] `auth-methods.ts` passkeys, enrolling an authenticator, changing a password and signing other devices out: `src/server/auth/passkeys.ts`, `account.ts`, the `/account` screen
- [ ] `auth-methods.ts` delivery of the WhatsApp code: arrives with the WhatsApp module
- [x] `schema.ts`, `db.ts`: replaced by `src/server/db` (Drizzle schema, `db/migrations`, Postgres schema `masar`)
- [x] deal storage and stages from `data.ts` and `actions.ts`: `src/server/deals` (save, stage, reject, reopen, read), tested on a real Postgres engine in memory
- [ ] the rest of `data.ts` and `actions.ts`: clients, credit, lenders, documents, notes
- [x] screens on the "الخريطة" direction: the road (home), the deals list, the deal file with stage moves and the step by step calculation, the deal editor
- [x] opening a client file and revising its facts, from `data.ts` and `actions.ts`: `src/server/clients`
- [ ] screens still to build: clients, lenders, inbox, calculator, knowledge, users, audit, client portal
- [ ] data migration from the live database, then the domain switch (only after the owner approves)

To regenerate a golden file while `legacy/` still exists: `npm run golden:deal`, `npm run golden:credit`, `npm run golden:simah`. Each generator is seeded, so it writes the same file every time.
