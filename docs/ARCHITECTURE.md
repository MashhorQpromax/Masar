# Masar v2 architecture

Masar runs a financing brokerage whose core business is the "settle and refinance" deal: the company pays a client's enforcement orders, defaults and mortgage payoff, holds the property as security, and recovers its capital plus a fee from the client's new bank financing. The numbers are real money, so correctness comes before everything else.

This branch is a rebuild from zero. The live site stays on `main` and its database is not touched from here. How the old system's data comes over, and the day of the switch, are in [MIGRATION.md](MIGRATION.md).

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
    clients/   Where a file stands, and the check of an identity number.
    eligibility/ What SAMA's rules leave in an income, what each lender's product would give,
               what a lender may ask for beyond its terms, the ways to a larger amount,
               and the profile a quick estimate is made from.
    funding/   Which lender funds the new financing of a bridge deal.
    analysis/  A client's credit and financial analysis: the file, the SIMAH record and the lenders'
               terms read together, with what is missing or unconfirmed named and never guessed.
    knowledge/ What the office learned about lenders beyond their terms: the notes people wrote down,
               and what lenders actually answered, added up lender by lender.
    project/   The study of a project that asks for finance against its land and its income: its ratios,
               what stands in its way, the ways to finance it, and the papers its file still needs.
    documents/ What a client's file needs today and where each paper stands.
    messages/  What may be said to a client and what a client may be told.
    audit/     The kinds of event the audit log holds, the part of the office each belongs to,
               and which of them deserve a second look.
    report/    The office's month: deals opened, closed and lost, the closed deals' fees as counted,
               and what the lenders answered.
  copy/        Arabic wording for every code the domain returns, the choices a form offers,
               and number, date and count formatting.
  server/      Everything that touches the outside world (database, auth, WhatsApp). Server only.
    db/        Drizzle schema (one file per area) and the connection.
    deals/     Deal service: validate, compute with the engine, store, move stages, audit. Read views for screens.
               A new client's first deal and a revision of a deal's numbers are each one transaction.
    clients/   Client files: the facts a deal is computed from, how a client is reached, notes,
               file numbering, and the list and the card the people screens read.
    auth/      Who is acting. Every route and action asks here first. Passwords, sessions,
               authenticator codes, one-time codes, passkeys, lockouts, and the accounts themselves.
    credit/    A client's credit reports: the upload, the reading, the stored record.
    lenders/   The catalogue of lenders and products: reading it, adding a lender or a product,
               correcting a product and stopping one.
    funding/   The funding routes of a deal.
    analysis/  A client's analysis, worked out on every read from what is stored. Nothing of it is kept.
    knowledge/ Notes about lenders and the decisions lenders gave: writing them down and reading them back.
    projects/  A project's file: opening it, changing it, and its study worked out on every read.
    documents/ A client's papers and their files.
    messages/  The conversation with a client, the client's link, the line to WhatsApp, the inbox.
    audit/     The reader of the audit log. Writing an event stays with the service that did the work.
    reports/   The office's month, read from the deals, their stages, lenders' answers and requests.
    demo/      A fictional office for a build that has no database: its deals, its people and its log.
    port/      The move from the old system's tables to this one's, its rehearsal, and what a deployment
               does around the build. Deleted with `legacy/` once the old tables are gone.
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
6. **Client-facing output cannot leak what the office earns.** Anything sent to a client (portal, WhatsApp) is built from client view types that have no profit, return or capital fields. The office's fee reaches a client in one place only, the final offer, and only from a fee plan the manager approved as the deal stands now (`ClientOffer`).
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
- **The first account** is made with `npm run user:create`. Every account after it is made on `/users` (see The office below).

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

The upload (`/clients/[id]/credit`, permission `doc.upload`) takes the PDF as SIMAH issued it, at most 4 MB (`REPORT_MAX_BYTES`, under the platform's request limit), reads its text with `unpdf`, runs the reader and stores the reading. The file itself is kept with the client's papers, under the `simah` paper (see Documents below); a newer report takes the place of the oldest when the paper is full. A reading passes the same schema as any other input (`src/server/credit/input.ts`). One thing is softened there on purpose: an inquiry's amount is only shown, never counted, and extraction often glues it to the number beside it, so an impossible one is stored blank instead of refusing the report.

`unpdf` is pinned to the exact version production runs. The reader depends on how that version lays text out, and `tests/server/pdf.test.ts` reads a made-up report from a real PDF (`tests/fixtures/simah-made-up.pdf`, made by `scripts/make-simah-pdf.cjs`) and expects the production reading. Upgrade the library only with that test green.

SIMAH shows neither a service suspension nor a travel ban. The reading assumes a suspension when an enforcement order is unpaid and marks it as assumed; the credit page then asks one question, answered in one tap after checking Absher or Najiz. A travel ban and a note are set in the manual review. Both go through `reviewCreditReport`, which grades the record again.

A build without a database refuses the upload: it holds invented clients only and is reachable by a shared link, so no real person's report is taken there. The demo carries invented records instead, one per state of the page.

The deal reads the client's newest record (`getDeal`) and hands the engine its three facts, so the deal's notes and its editor say the same thing as the credit page.

### From the record into a deal

What a record shows reaches a deal through the deal editor, where a person reviews every figure before it is saved. Nothing joins a deal unasked.

- `owedFrom(report)` reads the loans and cards still running (`current` or `late`) as commitments, by the name SIMAH gives the product. A product counts when the record gives it an installment or a balance; what it does not give stays empty and is never guessed. A phone line is not a commitment.
- `reportDrafts(report)` is everything the record says a deal has to deal with: `itemDrafts` over those commitments (court orders, unpaid defaults no order covers, loans and cards at an estimated payoff), then any other running finance with an installment, which starts as staying outside the deal with its installment counted against the new financing. Each draft names what the record did not give (`missing`: the amount, the installment).
- `pendingDrafts(drafts, items)` is what a deal does not hold yet. An item answers for a draft of its kind when it names the draft's lender or decision number, or has about its amount (the tolerance two readings of one debt are given). The surest match is made first, so of two loans from one lender the missing one is the one suggested. A draft the record gives no name for is known, last, by the label it is added under. Each item answers for one draft.
- `reportOffer` (`src/app/(app)/deals/report-offer.ts`) gives the editor the drafts with their labels and the report's day.

In the editor (`DealEditor`, prop `fromReport`):

- A new deal for a client whose record was read starts with the record's drafts as its items, under a line that says so and asks for every number to be reviewed. A payoff is marked as an estimate until a person writes the figure of the clearance letter (`PAYOFF_RATE`: 5 percent a year for a mortgage, 6 for the rest), and a missing amount or installment is said under its field.
- A deal in progress is never changed by a record. Above its items, the editor lists what the record shows and the deal lacks, each with one press to add it, and all at once when there is more than one. An item taken out is offered again.
- The credit page says the same thing as a next step: how many commitments the client's open deal lacks, with a link that lands on the list, or, for a client with no deal, a new deal that starts from the record. It shows for those who may change a deal.
- The record's own lines are shown to those who hold `client.view_pii`, the permission the credit page itself asks for.

The old system did this on upload (`uploadSimah`): it copied running products with an installment into the client's obligations, without review, and only when the client had none. The rebuild keeps no separate list of obligations: a deal's items carry them, and the table `obligations` is unused. Two things differ on purpose: a card or a loan with a balance and no installment is no longer left out, and it comes with its gap named.

Not built yet: opening a new client's file straight from a report. A file has to exist before a report is read into it.

`tests/domain/report-drafts.test.ts` covers the three functions and holds them over every record of the golden file; `tests/copy/credit.test.ts` adds every draft of every golden record under its label and expects nothing left to offer; `tests/server/demo.test.ts` keeps the demo's story (one card missing from a deal, a new deal that starts from a record).

Kept as the old system has them and worth a decision before the switch:

- a loan's early payoff is estimated from its balance and installment at an assumed rate, as the old system did. It can stand well below the balance SIMAH shows, and it is the deal's figure until the clearance letter replaces it
- after a settled default the grading keeps banks closed for 12 to 24 months, and the deal shows it as a warning, while the bridge deal goes back to a bank right after settlement. Which banks take a client with a fresh settlement letter belongs with lender matching
- `totalToClear` leaves out an open bounced cheque, and a travel ban or an open cheque alone still reads as a "clean" standing
- a settled telecom default causes no waiting period, and a settlement with no date is read as made just now

Four things differ from the old system on purpose. The analysis no longer writes a guessed creditor back onto the report; it returns the guess, marked as a guess. A bounced cheque is no longer paired with a default of a similar amount, which used to drop that default from the deal's list. A new card in the deal editor defaults to being bought out by the new personal finance, as the old item list already did. And the finding that asks for a phone bill to be paid (`TELECOM_DEFAULTS`) counts the unpaid bills only: the old engine counted paid ones with them and asked for a paid bill to be paid. The count in `stats.telecomDefaults` is unchanged.

## Eligibility

`src/domain/eligibility` answers three questions about a client and a kind of finance: how much room SAMA's deduction rules leave in the income (`capacity`), what each lender's product would give and why not more (`matchProduct`), and what that adds up to (`study`: a verdict, the products ranked, what helps, what hurts, what to do next). `requiredDocuments` lists the papers a lender asks for. Every answer is a code with its numbers; the sentences are in `src/copy/eligibility.ts`.

The numbers are locked to the old engine by `npm run golden:eligibility`. Old behaviours kept as they were, each worth a decision before the switch:

- A non-Saudi's first home is financed at 70 percent like a second home, and the 85 percent tier is never used.
- The 45 percent rule for obligations other than a mortgage never binds, because the salary rule is always tighter.
- When a client retires inside a consumer finance term, the installment after retirement is a quarter of the pension with existing installments not taken off.
- The score takes 2.5 points off for every percent of the effective rate, so a cheap product outranks a better fit.

One thing changed on purpose: the old list of documents could name a paper twice (a self-employed client asking for project finance), and the old screen then stored it twice. The new list names each paper once.

### The advisor and the calculator

`advisor.ts` says what the formula does not. `hiddenConditions` lists what a lender may ask for or hold against the client that no term of a product shows: 26 conditions, each with a level (`block`, `warn`, `info`) and a source (SAMA or market practice). `waysOut` lists the ways to a larger amount, and each one is the engine run again on the changed profile, so its effect is a number: paying off or selling one debt, one lender buying them all, the longest term, a co-borrower (with the smallest income that covers what is asked, found by search), housing support, a clean record, a term that ends at retirement. `advise` is the study with both. The sentences are in `src/copy/advisor.ts`.

Both are locked to the old advisor by `npm run golden:advisor`: 360 clients against the seeded catalogue, every condition with its level, source and numbers, and every way with its amount, gain, verdict and numbers. The alerts the old advisor took from a credit report (`credit_block`, `credit_warn`, `credit_fc`, `credit_clear`) were not ported: the credit record screen says them, from the record itself.

`quick.ts` builds the profile of a quick estimate from the few facts a person has on the phone (`quickProfile`), as the old calculator did: a citizen with no salary bank named, a basic salary taken as 70 percent of the total when it is not typed, and what is paid every month as one consumer installment and one mortgage installment. An estimate never waits for facts, and it is still an answer about lenders, so it is no surer than their terms: its verdict is the best of the four strict results any product gives (`quickVerdict`), and the product it names is the one that lends the most among those whose answer can be relied on most (`largestOffer`, `openOffers`).

The calculator is `/lenders/calculator`. Anyone who works in the office may open it. The page reads the catalogue once, and the engine then runs in the browser as each number is typed: nothing typed there is sent or kept. It shows the result and the amount of the lender it names, a month of income in three parts (what is owed, what a new installment may take, what is left), the lenders that take the client as their terms are written, each with its own result and what is confirmed of it, the ones that do not with why, the first five ways out and the first five conditions. The ways out are worked on the terms as written and say so. `/lenders` and the calculator share one row of links (`LendersNav`).

## Funding routes

`src/domain/funding` answers the question a bridge deal ends with: which lender funds the new financing. It is new, not a port: the old system matched products to a client and studied deals apart, and the two disagreed about a client whose default was just paid.

- A route is one lender's product for each part the deal's structure has: a mortgage, a personal finance, or both. With both, each mortgage product is paired with the personal product that serves it best, and never with a second lender that also wants the salary.
- Acceptance comes from the eligibility engine's conditions on the person (salary, sector, nationality, age, service, salary transfer). Amounts and the verdict come from the deal engine run on the lender's own terms, so a route's numbers are the deal's numbers.
- The credit record is read as it will stand after the settlement: `recordAfterSettlement` (an open default, a default paid and how long ago, recent late payments, or no report). Each product says how long it waits after a paid default in `settledDefaultWaitMonths`: 0 takes the client at once, a number of months refuses until they pass, and null means nobody has confirmed it, which is a condition and not a refusal.
- Routes rank by: a lender that would take the client, a deal that closes, what the client keeps, one lender over two, fewer conditions, the lower installment.
- A lender's ceiling is part of the deal engine (`mortgageCeiling`, `personalCeiling` on the input): it holds an estimate and never an offer the lender actually gave. The ledger shows it as its own line.
- `applyRoute` writes a route's terms on a deal in progress. It works the routes out again on the server, refuses a route the lender would turn down, and never replaces a recorded offer.
- The catalogue starts from `src/server/lenders/base.ts`. Its terms are indicative until someone confirms them on the `/lenders` page, and every screen that shows them says so.

## Credit and financial analysis

`src/domain/analysis` reads three things together: what the client's file says, what the newest SIMAH record shows, and the terms of the lenders in the catalogue. `analyzeClient` returns one `ClientAnalysis`. It is new, not a port, and it adds no rule of its own: the record's grading comes from `src/domain/credit`, the room in the income from `capacity`, a product's conditions on the person from `matchProduct`, and its reading of the record from the funding rules (`recordAfterSettlement`). The page is `/clients/[id]/analysis`, behind `client.view_pii` like the credit page.

The ground rule is that nothing is assumed. A figure that is not in the file or the record is listed as a gap and nothing is put in its place.

- `commitmentsOf(report)` lists the finance the record shows as still running. A card or a loan with no installment on the record is listed and not counted: the share of income is then a floor and every room a ceiling, and both are said so (`burden.uncounted`).
- The income is the total salary plus half of a regular other income, as the eligibility engine counts it. Its basis is `verified` only when a checked paper states the salary the income is counted from and agrees with the file (`incomeProven`, below); `disputed` when a checked paper states another; otherwise `stated`, and that is a gap.
- `burden.share` is the installments on the record as a percent of that income (the debt burden ratio). `kinds` holds, for each kind of finance studied, the room SAMA's rules leave and every active product held against the client and read strictly (a `Fit` carries its result, its doubts, blockers, leanings, what the client has to do, the strength of its source and whether its figures are firm). The order is: an answer that can be relied on, then the product with the fewest terms left to confirm, then `fitScore` (no refusal, fewer conditions, how much of the request it covers, the rate, and the bank the salary is paid into).
- When something on the record blocks every lender, each kind carries a second reading, `cleared`: the same products once it is paid. It is shown as what could follow, with the line that paying does not guarantee acceptance. A product says how long it waits after a paid default only once someone wrote it down and confirmed it (`settledDefaultWaitMonths`, null until then), so after a payment a lender nobody asked needs verification and is no promise.
- `strengths` and `risks` carry where each was read (`source`: the file or the record). Risks are the blockers, what the record warns of, three things it only notes and a lender may still ask about (a paid default, an unpaid phone bill, an old delay), then what the file adds. A middling score or a moderate card balance is in neither list.
- `gaps` are what the analysis could not stand on, each `conflict`, `missing` or `unconfirmed`: first every fact the file and a checked paper state differently, then income, proof of income, age, service, salary bank, an installment the record does not give, a card's share, the report's age (`STALE_REPORT_MONTHS`, counted in whole months by the day), a reading nobody reviewed, an assumed suspension, unverified lender terms, and the client's consent.
- `steps` are what to do next, in order: record the consent, complete the file, settle what the file and its papers state differently, review the reading, confirm the suspension, what the record needs (lift, settle, pay), a newer report, free room, verify the income, then for each kind the lender to ask and the application to the best fit. `CONFIRM_TERMS` names a lender whose answer rests on terms nobody confirmed, once per lender with the terms to ask about. When the application only opens after the record is cleared, that step goes ahead of everything the record needs: asking a lender costs nothing and paying a default does, and the office pays nothing on the strength of a term nobody confirmed.
- The verdict is one of the four strict results, or `pending`. It is the best result any lender gives that would lend something: a lender nobody confirmed never makes the client eligible and never makes them refused, while a debt that stands on the record refuses for certain, since no lender has to confirm that. It is `pending` when the consent is not on file, the income is missing, no kind could be studied or the reading's confidence is low. `afterClearing` says what it becomes once the blockers are paid.

`getAnalysis` (`src/server/analysis/service.ts`) works it out on every read from the stored file, the newest record and the catalogue as it stands. Nothing of it is stored, so it cannot fall behind them. Before a record is read there is no analysis: the page shows the upload and nothing else.

Consent. `clients.consentAt` is when the client agreed to the processing of their data and their credit report. `setConsent` records it or its withdrawal, with an audit entry (`client.consent`). `addCreditReport` refuses a report for a client with no consent on file (`CONSENT_NEEDED`); the upload form carries the tick that records it in the same step. Without it the analysis still shows its figures, says `pending`, and makes recording the consent the first step. The credit page and the deal pages are not gated on consent yet: that belongs with the controls phase. The old system took the client's consent when a file was opened and stamped it, and that stamp comes over with the file; a file brought over without one shows the gap until someone records it.

The page prints. `PrintButton` opens every folded list before printing and folds them again after; the `@media print` block in `src/ui/ui.css` keeps the desk layout on A4 (`.page { zoom: 0.66 }`) and shows the line that the analysis supports a person's decision and is not a lender's approval (`DECISION_SUPPORT`, also at the foot of the screen).

Choices made here that the owner has not reviewed, each worth a decision before the switch:

- a card with no installment on the record is not counted in the share; some lenders count a percent of its limit
- a report is flagged as old at three months
- the mortgage room counts the existing mortgage as a commitment, as if it stays
- a client with no deal has their salary and birth year edited only through a deal

`tests/domain/analysis.examples.test.ts` holds worked examples small enough to check by hand, and checks that the analysis of every record in the golden file holds together (the total is the sum of what the record gives, a blocked record leaves no lender open today). `tests/copy/analysis.test.ts` words every gap, step, mark and condition the golden records produce against seven files and four readings. `tests/server/analysis.test.ts` reads the demo's clients end to end, with the consent and the income paper changed underneath.

## Keeping the catalogue

The catalogue is kept on `/lenders` by whoever holds `lender.manage` (the manager and the analyst). Everyone else in the office reads it. `src/server/lenders/service.ts` does the writing, each act in one transaction with an audit event in the lenders' part of the log:

- `addLender` adds a bank or a finance company by its name. A name the list already holds is refused whatever its spelling (`foldText`), and the refusal names the lender as the list writes it (`LENDER_KNOWN`). A bank also becomes a bank a salary can be paid into: its code is the one its name speaks of (`bankCodeIn`, so "البنك العربي الوطني" is `anb`), or `bank_` and its number when the name speaks of none or the code is taken.
- `addProduct` adds a product to a lender: its kind (personal, mortgage, cars, businesses: `PRODUCT_KINDS`), what it is called, who it is given to (sectors, nationalities, the youngest age) and its terms. The share of a property's value is kept for a mortgage only. From then on every deal and every estimate is matched against it.
- `updateProductTerms` corrects the terms, and with a `scope` also the name and who the product is given to. It writes nothing when nothing changed. A source confirmed the value that stood, so every term whose value changes goes back to unconfirmed, and the answer names those terms.
- `confirmTerms` and `withdrawTerms` say where a term comes from, and take that back. They are the next section.
- `setProductActive` stops a product and brings it back. Nothing in the catalogue is deleted: the old system had a box for a product in use and no deletion either, and a lender's notes and the decisions it gave stay readable. A stopped product is matched against no client. A lender is never stopped itself: with no running product it is out of every calculation and out of sight of everyone but its keeper, who still sees it with its stopped products and can add to it.

`listCatalogue` reads the lenders with their products. Its plain reading is what the office works with: running products, and the lenders that have one. With `stopped: true` it is the keeper's reading: stopped products and lenders with none as well.

Input is checked at the edge (`src/server/lenders/input.ts`): a name is trimmed and its spaces collapsed, sectors and nationalities are stored once each and in the engine's own order whatever order they were ticked in, and anything out of range is refused whole. The page keeps one form for both acts (`ProductForm`): it corrects a product, and with a lender instead of a product it adds one, starting from what such a product usually is (people on a salary, citizens, 60 months, or 300 for a mortgage) and leaving the margin and the largest amount for the person to write. A new lender's tile opens on the form for its first product.

The old system did all of this in one action (`saveProduct`), which also created a lender typed beside a new product. Three things differ on purpose. A lender is added on its own and a twin is refused, where the old form made a second lender of the same name. Nothing is worked out again for open clients after a change, because the rebuild matches on read and stores no answer. And the free note a product had is not asked for: what the office learns about a lender is a note on the knowledge page.

Not built, and the old system did not have them either: renaming a lender, moving a product to another kind or lender, and merging two lenders entered twice under different names.

## The strict reading

A lender's term is a claim about a lender. Until someone checks it against a source it is not known, whichever way it points, and no result given to a client rests on it. This is the first phase of the advanced roadmap, and it sits on top of the engines above without changing a number they produce.

**Where a term comes from** (`src/domain/eligibility/terms.ts`). A product has thirteen terms (`TERMS`): the nine that decide whether the lender takes the client (`CONDITION_TERMS`: salary, sector, nationality, age, service, salary transfer, late payments, what it does after a paid default, and the list of its special conditions, described below) and the four that decide how much and at what cost (amount, tenor, share of the property's value, margin). `TERM_FIELDS` says which stored fields each term speaks for. A source is a paper the lender issued, a page of its site, or what one of its employees said (`SOURCE_KINDS`); the first two are written, the last is verbal (`strengthOf`). What the office saw a lender decide in earlier files is experience: it ranks lenders and confirms nothing, so it is not a kind of source. A confirmation is good for three months (`TERM_VALIDITY_MONTHS`) from the day the source was checked, counted in Riyadh days. `termStanding` answers confirmed, expired or unconfirmed for a term as of a day.

**Keeping it** (`masar.term_sources`, one row per product and term). `confirmTerms` writes the source beside every term it speaks for; confirming a term again replaces what confirmed it, and the audit log keeps both. It refuses a source that names nothing, a site with no address, a day ahead, a day so old that the confirmation would be born expired (`sourceProblem`, answered as `SOURCE_REFUSED` with the reason), a term the kind of product does not have, and confirming what a lender does after a paid default while nobody wrote it down (`TERM_VALUE_MISSING`). Only `lender.confirm` may confirm or withdraw, and only the manager holds it. A product's `verified` is worked out: every one of its terms can be relied on today. The old `verified_at` column is kept and read by nothing: the old system's mark came with no source, so the move reports how many products carried it and brings every term over unconfirmed.

**Reading an answer** (`src/domain/eligibility/strict.ts`). The engines still answer each condition with pass, warn or fail from the stored values. `findingOf` asks of every answer whether it can be relied on, by the rule of its code (`CHECK_RULES`, and `ROUTE_RULES` for a route): who sets the condition (the regulator, the market, this lender, or nobody when it is a fact about the client), which term it rests on, and whether a warn is something the client has to do. An answer on a term that is unconfirmed or expired is unknown and keeps which way the stored value leans. A fact the file lacks is unknown and never counts as met. A regulatory or a market condition needs no lender to confirm it. `eligibilityOf` gives one of four results:

- `eligible`: every condition that could be checked is met, on confirmed terms. The lender still decides.
- `conditional`: the client has something clear to do first.
- `not_eligible`: a confirmed condition stands in the way. No calculation overrides it.
- `needs_verification`: a fact is missing or a term is unconfirmed, so no reliable answer exists.

`tell` sorts the findings of one answer into what is said of it (`Telling`): `doubts` to check, `blockers` that are certain, `leans` (what an unconfirmed term would refuse or ask as it is written), `actions` the client has to take and `remarks` a lender is confirmed to accept. The four terms that set figures (`AMOUNT_TERMS`: amount, tenor, share of the value, margin) decide no result: while one of them is open the result stands and its figures are `estimated`.

A route carries the same reading (`eligibility`, the telling, `strength`, `estimated`, `blockedAsWritten`), and so do a product matched to a profile (`strictMatch`) and a product in a client's analysis (`Fit`). Among routes that close, one with a reliable answer is listed before one without (`eligibilityRank`). Two lenders that both want the salary refuse for certain only when both their salary terms are confirmed. A lender's own condition is told once per lender and one that binds every lender once for the route. What the client has to do (`actions`) is only ever a reliable answer: the same demand on an unconfirmed term is a doubt, something to ask the lender and not something to tell the client.

**Seeing it.** A deal's lenders page (`/deals/[id]/lenders`) names the result of the best route and says why in that order: confirmed blockers, each with who sets it (`BASIS`); refusals that rest on an unconfirmed term, worded as what the record leans to (`routeLeanLines`); what has to be checked, the file's missing facts first and then each lender's open and expired terms (`routeDoubtLines`); what the client has to do; and what a lender is confirmed to take. A result that rests on an employee's word says so, and the amounts are called indicative while a term that sets them is not confirmed. Putting a route on the deal is named for what it does, calculating the deal on that lender's terms, and it is not an approval of anything. `/lenders` shows under each product its sources, each with the terms it speaks for and the day it stops being good, the terms nobody confirmed, and for the manager the form that confirms them. The client's analysis and the calculator say the same four results with the same lines (`strictLines`, `strictRefusalLines` in `src/copy/funding.ts`): how many terms are open, what the record leans to, what the client has to do, whether the answer rests on an employee's word, and whether the figures are firm. Neither calls a client eligible or refused on a term nobody confirmed. The demonstration never shows a real lender's term as confirmed: `src/server/demo/lenders.ts` adds two lenders named as examples, with made-up terms and sources that say so, and every result of the strict reading is seen through them. Neither takes the private sector, and one invented client works in it: her analysis is the one where every lender is still a question, and its plan asks the lender before anything is paid.

### Special conditions

What a lender asks beyond the terms every product has is a list kept per product (`masar.product_conditions`, `src/domain/eligibility/special.ts`). It is the second part of the first phase, and like the first it changes no number the engines produce: a product with no special condition is matched exactly as before, and the list is read only at the strict layer (`strictMatch`, a route's legs, a `Fit`).

- **The list is one term.** `special` stands for the whole list, an empty one included. A list nobody confirmed is unknown whichever way it points: an empty list does not say the lender asks for nothing. Writing a condition down or taking one off drops the source that confirmed the list (`addCondition`, `removeCondition`, audited as `lender.condition_add` and `lender.condition_remove`), so the manager confirms it again with the source that states it. Whoever keeps the catalogue (`lender.manage`) writes and removes; only `lender.confirm` confirms.
- **Three kinds the system measures.** `min_amount` against the amount asked or the most the client can take, `inquiries` against what the SIMAH record counts in the last 6 or 12 months, and `contract` against the kind of employment contract in the file (`clients.contract_type`: permanent, fixed term, probation; a retiree and the self-employed have none). A fact the file or the record lacks is `FACT_MISSING`, never a pass.
- **Four kinds a person answers.** `employer`, `guarantor`, `collateral` and `other` carry the lender's words and what it does with a client who does not meet them (`unmet`: `block` refuses, `action` asks the client for it). The answer is kept per client and condition (`masar.condition_answers`, `answerCondition`, audited as `client.condition_answer`). Until someone answers, the condition is open (`ASKED_OPEN`) and the result is `needs_verification`; met passes; not met is `not_eligible` or `conditional` by `unmet`. An answer to a condition that was taken off answers nothing.
- **Refusing a list that contradicts itself** (`conditionProblem`, answered as `CONDITION_REFUSED` with the reason): a second least amount, a second limit for the same window, a second rule on the contract, a least amount above the product's most, a contract rule that accepts every kind, the same question twice, and a condition of no known kind that says nothing. The other way round is refused too: the most a product lends cannot be lowered under a least amount written for it (`AMOUNT_BELOW_LEAST`).
- **A stored row the code cannot read is never dropped** (`conditionOf`): it becomes a question a person answers, with `unmet: "block"`, so a condition is never lost because its shape is unfamiliar.

`/lenders` shows the list under each product with the form that adds to it (`ConditionForm`). `/clients/[id]/conditions` (behind `client.view_pii`; answering needs `client.edit`) lists every question the running products ask about one client, with two answers and a way to take an answer back. The contract is a field of the client in the deal editor. The analysis plan gains `ASK_CLIENT` (before anything is paid, when the plan pays first) and its file step gains the contract; a deal's lenders page links to the answers when its best route waits on one. In a route with two lenders an open question carries the name of the lender that asks it (`doubtLines`). In the demonstration each of the four example products carries one kind, and one invented client has the guarantor answered while it stays a question for the others; no real lender is given a condition.

`tests/domain/strict.examples.test.ts` holds the worked examples, `tests/copy/funding.test.ts` the lines a route is explained in, `tests/server/lenders.test.ts` the keeping of sources, `tests/server/funding.test.ts` one deal's route through all four results, `tests/domain/analysis.examples.test.ts` the analysis under confirmed, unconfirmed and half-confirmed catalogues, `tests/copy/calculator.test.ts` and `tests/domain/quick.test.ts` the estimate, and `tests/server/demo.test.ts` what the demonstration shows. For special conditions: `tests/domain/special.examples.test.ts` (each kind through the four results, the routes and the analysis), `tests/server/conditions.test.ts` (keeping the list and the answers), and the wording in `tests/copy/eligibility.test.ts`, `tests/copy/lenders.test.ts`, `tests/copy/funding.test.ts`, `tests/copy/analysis.test.ts` and `tests/copy/audit.test.ts`.

### The file against its papers

The third part of the first phase holds what the client's file says against what their checked papers say (`src/domain/documents/facts.ts`, `src/domain/eligibility/conflict.ts`, `src/server/documents/facts.ts`). A paper is kept as a file and the system does not read it, so a person writes down what it states.

- **Three facts.** A paper is held against the file on the facts both hold: the total salary, the basic salary and the year of birth (`PAPER_FACTS`). Which paper states which is `PAPER_STATES`: the identity card the year; a salary certificate and a payslip both salaries; a pension statement the total; a GOSI statement the basic wage only, because the wage it registers is the basic one with housing and not the whole salary. A paper a person added by name states none the system knows. Nationality is in the identity number already, the sector is a classification rather than a figure on a paper, and the salary bank is limited to the banks of the catalogue, so none of them is held against a paper.
- **Written by whoever checks it.** Finding a paper that states something good opens its fields, and the first one is required: what is found good is the paper with its figure. The figures are kept in `documents.stated` and audited with the verdict (`doc.review`); a checked paper's figures can be corrected or taken back (`statePaper`, `doc.state`). They are bounded (`statedProblem`: a fact the paper does not state, a salary that is not a positive amount up to ten million, a year before 1930 or less than eighteen years ago, a basic salary above the total on the same paper) and a year typed from the Hijri date is turned into its Gregorian year at the edge. A figure counts only while its paper stands as checked: a new file, a removed file, a file moved in or out and a paper sent back all clear it, and the paper is looked at again. A checked paper nobody wrote a figure from proves no figure: the absence of a difference is not agreement.
- **Agreement and conflict** (`readFacts`). For each fact the file and every checked paper that states it are compared: two salaries agree within one part in a hundred of the larger (`SALARY_TOLERANCE`), two years within one, since a Hijri year falls in either of two Gregorian ones (`BIRTH_YEAR_TOLERANCE`). A fact is `unstated` when no checked paper states it, `agrees` when every one says what the file says, and `conflict` when the file differs, the file is empty, or two papers differ. `incomeProven` asks of the salary the income is counted from (the total, or the basic when the file has no total).
- **On every study of the client.** A disputed fact adds `FACT_CONFLICT` to the strict findings, never to the engine's checks: its rule is a fact about the client nobody can rely on (`{ basis: "client", missing: true }`), so every lender of a route and of the analysis reads `needs_verification`, once per route and with no lender's name, while a confirmed blocker still decides alone. No figure changes and no lender's condition changes (`matchProduct` is untouched). The analysis puts the conflict first among its gaps and `SETTLE_CONFLICTS` right after completing the file; an application whose every term is confirmed and that waits only on the file says so (`termsOpen`).
- **Two ways out.** When the checked papers agree among themselves, the file takes what they say (`relyOnPaper`, which needs `doc.verify` and `client.edit`, audited as `client.fact_rely` with both figures and the paper, and refused as `RELY_REFUSED` with its reason). A paper that states both salaries gives both where both are disputed; the file is never left with a basic salary above the total; the client's deal in progress is computed again in the same transaction (`recomputeOpenDeal`). When the papers differ among themselves, taking one settles nothing: the one that is wrong or out of date is sent back, or what was written from it is corrected. Nothing records a decision to keep a conflict: it stands until the file or the papers change.

`/deals/[id]/documents` shows what was written under each checked paper, a panel of the conflicts above the papers with the button that takes the paper's figure, and the form that writes or corrects the figures. In the demonstration one invented client's identity card states another year of birth than his file, and settling it lets the example lender answer; another's papers agree with his file.

`tests/domain/facts.examples.test.ts` holds the worked examples, `tests/domain/strict.examples.test.ts` and `tests/domain/analysis.examples.test.ts` the conflict on a route and in the analysis, `tests/server/facts.test.ts` the writing, clearing and relying end to end, `tests/server/demo.test.ts` the demonstration, and the wording `tests/copy/documents.test.ts`, `tests/copy/eligibility.test.ts`, `tests/copy/funding.test.ts`, `tests/copy/analysis.test.ts` and `tests/copy/audit.test.ts`. Tests about other things take the demonstration's conflict away first (`tests/helpers/demo.ts`).

Choices made here that the owner has not reviewed: the three facts and no others, a GOSI statement's basic wage only, the two tolerances, that an income is proven only by a figure written from a paper, and that settling a conflict writes the paper's figure into the file.

### The deal against the record

The fourth part holds the amounts a deal carries against the client's SIMAH record (`recordDifferences` in `src/domain/deal/from-credit.ts`). The office pays the court orders and defaults, so a deal that holds less than the record says is owed is a deal whose capital is short.

- **Which debts.** Only a court order and a default (`FIXED_DEBTS`): their amount is fixed by the court or declared by the lender. A running loan is left out, because its balance on the record is older than the deal and falls every month; its payoff is settled by the lender's letter, which a payoff already carries as its own mark.
- **When it differs.** A draft of the record is found in the deal as `pendingDrafts` finds it (`placeDrafts`). It differs when the item names the same lender or decision number and its amount is beyond the tolerance two readings of one debt are given (`CREDIT_RULES.sameDebtTolerance` and `sameDebtShare`: 1,500 riyals or two parts in a hundred, whichever is more). An item matched by its amount alone, or with no amount on either side, differs from nothing.
- **Settled by a paper.** An item whose amount the creditor confirmed (`confirmed`, the mark a payoff gets from its clearance letter) is newer than the record and differs from nothing. The editor shows the mark on a court order or default only while it differs or is set, and saves it only when set, so saving an old deal changes nothing.
- **Said, never decided.** A difference changes no figure of the deal's study and no lender's answer: the golden tests that lock the engine's numbers are untouched. It is a warning among the deal's notes, for those who may read the record (`client.view_pii`); under the amount in the editor ("في تقرير سمة ..."); and the next step on the record's page when the deal holds everything the record shows but not at its amounts.

In the demonstration one invented client's default grew since her deal was written. `tests/domain/report-drafts.test.ts` holds the worked examples, `tests/copy/credit.test.ts` the wording and a pass over every record of the golden file, and `tests/server/demo.test.ts` the demonstration.

Choices the owner has not reviewed: court orders and defaults only, the tolerance taken from matching one debt across two readings, and that a creditor's confirmation is a mark a person sets rather than a paper the system holds.

### Approving the recommendation

The fifth part signs the analysis (`src/domain/analysis/approval.ts`, `src/server/analysis/approval.ts`, table `analysis_approvals`, migration `0009`). The analysis itself is never stored: it is worked out again on every reading, so it is evaluated afresh whenever anything it reads changes. What is stored is the approval, and what it rested on.

- **Who.** `study.approve`, the manager alone, as the roadmap's default says until the owner decides otherwise.
- **Complete or not** (`completeness`). A recommendation is complete when its best answer does not need verification, nothing about the client is missing, unconfirmed or in dispute, and the lender it sends the client to stands on confirmed terms. The catalogue's other unconfirmed lenders (the analysis's `TERMS` gap) do not make it incomplete. An incomplete one is approved only with a written reason of at least fifteen characters (`REASON_MIN`), kept with what was open; an analysis that cannot be read (`pending`: too little on file, or no consent) is not approved; nor is one whose file disagrees with a checked paper (`CONFLICT`), whatever the reason, since every lender's answer waits on which figure is true; one already approved on the same prints is not approved twice (`approvalRefusal`, refused as `APPROVAL_REFUSED` with the reason).
- **Four prints** (`AnalysisView.fingerprint`). Each part an approval rests on is printed (sha-256 of a canonical text, `canonical`): the file as the analysis reads it (salaries, age, service, answers, conflicts, consent), the record as it was read and answered, the terms and sources of the products the recommendation sends the client to, and what it found about the client (`approvalBasis`: verdict, the lenders it sends to, its plan, its gaps but `TERMS`, the income, the burden, the strengths and risks). Confirming another lender's terms does not unsettle an approval unless it changes where the client is sent. The terms are printed with their standing on the day, so a confirmation that runs out its three months drops the approval too.
- **Falls by itself.** An approval stands while all four prints match the analysis as it reads now. When one does not, the page says the approval fell and what changed (`changedParts`), and the manager approves again. Nothing is deleted: every approval stays in the log beside the analysis, newest first, with who (their name as it was, kept with the approval), when, whether it was complete, where it sent the client (each lender, kind, amount and the answer it had then), the reason, and whether it stands. The row keeps what the analysis read and found (`basis`: the file's facts, the record's id and the whole result), and the audit log `study.approve` with the result, what was open and the reason.

`/clients/[id]/analysis` shows the approval under the plan and the gaps, with the form for whoever may approve (the reason is asked only when something is open) and the log folded under it. In the demonstration one invented client's approval stands, and another's fell when her file changed (`seedDemoApprovals`); the client whose identity card disagrees with his file shows why he cannot be approved yet.

`tests/domain/approval.test.ts` holds the rules, `tests/server/approval.test.ts` the approval end to end (refusals, a fall by file, record and lender, and a lender that does not unsettle it), `tests/server/demo.test.ts` the demonstration, and the wording `tests/copy/approval.test.ts` and `tests/copy/audit.test.ts`.

Choices the owner has not reviewed: the manager alone approves, the length of a reason, what counts as complete, that a conflict with a paper cannot be approved over at all, and that any change to the four parts drops the approval with no tolerance.

## Fees and the client's net

Phase two of the owner's roadmap. Its five parts are built. On 2026-11-24 the owner decided that no VAT is counted on the fee for now: fees and offers stay as they are, and nothing in the engine, the plan or the client's offer knows a tax on the fee. There is no tax setting yet. When the office comes to charge VAT, it is to be built in one of the two ways he was shown: fifteen percent added as its own line after the fee and taken from what the client keeps, or a fee that includes it with the offer saying how much of the fee is tax. Which deals it then reaches (new ones only, or those still open) is a question for that day. On 2026-11-23 the owner decided the client sees the fee in detail in their final offer (the percent, what it is counted on, every item), and never the office's profit or capital.

### The fee policy

The manager sets the office's fee policy on `/settings/fees` (`settings.manage`): the two percents a new deal starts from, what the finance percent is counted on, and the lowest and highest percent a deal may carry (`FeePolicy` in `src/domain/deal/fee.ts`; table `office_settings`, migration `0010`; `src/server/settings/fees.ts`). With nothing set it stands at ten percent on each part, inside ten to thirty-five, which is what the engine's own `FEE_MIN` and `FEE_MAX` say. A policy whose range does not hold, or whose start is outside its own range, is refused (`policyProblem`). Every change is logged as `settings.fees` with what it was before, and is among the watched events.

The policy also holds the terms a fee is owed on (`FeeTerms`): when it falls due (`due`: when the financing is paid out, when the lender approves, or when the agreement is signed) and how it is collected (`collection`: deducted from the financing, or paid by the client's transfer). With nothing set they are the office's own model, due when the financing is paid out and deducted from it (`DEFAULT_TERMS`). A fee can be deducted from the financing only when it falls due at the payout, so any other pairing is refused (`termsHold`, problem `TERMS`), and the settings form moves the collection to a transfer when an earlier due date is chosen. They live in the same stored JSON, so a policy saved before them reads with the defaults and needs no migration.

- **A new deal** starts from the policy (`policyFee`). A saved deal keeps its own fee: a new policy changes no deal.
- **Changing a deal's fee** (either percent, the base, whether payoffs count, the flat amount) away from what it had, or from the policy for a new deal, needs `fee.set` (manager and analyst), percents inside the policy's range, and a written reason of ten characters or more (`feeRefusal`, refused as `FEE_REFUSED` with the reason and the range). A fee kept as it was is never refused, even one an older policy allowed. The change is logged as `deal.fee` with the fee before and after, the parts that changed, the reason and the amount it comes to.
- Whoever may change a deal and not its fee sees the fee fields locked in the editor (`DealEditor`, prop `fee`). The editor asks the reason as soon as the fee moves, keeps the engine's suggested percent inside the range, and says the range.
- The system's own writes (the demonstration, the move) pass no `FeeBy` and set the fee as given, unlogged apart from `deal.save`.

Choices the owner has not reviewed: the analyst may set a fee; ten characters of reason; the range binds each percent alone; the engine's suggestion still steps by five from its own ten.

### What the finance percent is counted on

Four bases (`FinanceBase`): all the new financing, the personal part, the mortgage part, and `net`, what is left of the financing once every obligation the deal settles (by the office or by the lender) and every cost (the lender's admin fee, the taxes, the fixed costs) is paid, before the office's fee. It is the summary's `afterSettle`, now worked out once before the fee and reused, and it is never below nothing: a deal with nothing left pays no finance percent. The first three are locked to the old engine by the golden tests; the fourth is new (migration `0011` adds it to `finance_base`) and is checked by hand in `tests/domain/deal.examples.test.ts`.

### Approving the fee plan

The manager approves a deal's fee plan (`fee.approve`; `src/domain/deal/plan.ts`, `src/server/deals/plan.ts`, table `fee_approvals`, migration `0012`). What is kept is a copy that never changes (`FeePlan`): the fee as set, what each part comes to and on what, the new financing, the capital, what is left before the fee, what the client keeps, and the verdict. Beside it is the print of everything it rests on: every input of the deal but its notes, and every line the engine worked out (`planOf`), so a change anywhere the numbers come from drops the approval, a fact about the client that moves the estimate included. The office's policy changing does not: a saved deal keeps its fee.

The copy also keeps the terms the fee is owed on (`FeePlan.terms`), read from the policy at the moment of approval. They are not part of the print: a later change of the policy neither drops an approval nor changes the terms it was approved on, and a new approval takes the terms of its own day. A copy approved before the terms were kept has none, and none are shown for it (`readTerms`).

- A deal that does not close (a deficit, or a valuation still missing) is not approved (`NOT_CLOSING`): a deal with a deficit is a rejected file. A deal already approved as it stands is not approved twice (`STANDS`). A finished deal is not approved at all.
- When it falls, the deal's page says what moved (`planMoves`: the fee, what the client keeps, the financing, the capital, each from and to, or the fee's own parts), and the manager approves again. The new copy sits beside the old in the log, newest first; nothing is deleted.
- Logged as `deal.fee_approve` with the fee, what it comes to, what the client keeps, and the terms it was approved on.
- The tile sits on `/deals/[id]` above the step-by-step account. Under the fee it says the terms: the approved copy's while the plan stands, the policy's otherwise. In the demonstration one invented deal's plan stands and another's fell (`seedDemoPlans`).

### The client's final offer

The owner's rule is that a fee enters the client's final offer only once approved, and his decision is that the client then sees it in detail. `clientOffer` (`src/domain/messages/offer.ts`) makes the offer from the approved copy and the deal as it stands, and `offerOf` (`src/server/messages/service.ts`) gives it only while the approval stands (`standingApproval`).

- **What it holds** (`ClientOffer`): each part of the new financing, what is paid out of it for the client (the obligations as one figure, each cost by name), the fee item by item (the percent, the amount it is counted on, what it comes to, and the flat amount), what the client keeps, and the monthly deduction from their salary after the new financing, which the roadmap shows to the client beside the net and the costs and which is always an estimate. Under the fee it says when the fee falls due and how it is collected (`fee.terms`), from the approved copy and never from today's policy; a fee of nothing, and a copy with no terms, say none. An item that comes to nothing is left out. It has no field for the capital, the return, the cover or the office's ledger.
- **It reads as a sum.** The financing, less the obligations, the costs and the fee, is what the client keeps, to the riyal (`offerTotal`), on every golden deal that closes.
- **When there is none.** A deal that does not close, a cancelled deal, a deal with no approval, and a deal whose approval fell have no offer. The copy is also checked against the deal: its fee, its total and the client's net must be the deal's own now, and its parts must add up, or nothing is shown.
- **Where it is seen.** A sixth message, "العرض النهائي", on `/deals/[id]/messages`, which the gate opens only with `approved` (`messageGate`); sending or recording it without a standing approval is refused (`GATE_CLOSED`). The client's own page shows the same offer in place of the rounded figures. The deal's page links to it from the plan tile once the plan stands.
- **Certainty.** Every figure keeps its mark: a financing with no written offer, the obligations without their letters, and the costs are said as estimates, and so is a fee counted on them.

Choices the owner has not reviewed: the offer is its own message beside the study summary; it shuts the moment a number moves, with no grace; amounts are to the riyal with estimates marked; the costs are named one by one; the lender is named only when the person chooses; the roadmap's "نسبة الاستقطاع" is read as the monthly deduction from the salary, shown without the regulatory cap; the study, papers and progress messages still carry no fee; the three due dates and two ways of collecting are the ones offered, the defaults follow the office's model, the terms are one setting for the office and not per deal, and they only word the offer and the deal's page: nothing is collected, scheduled or reminded by the system.

### Confirmed and estimated

Every figure of the client's net says where it comes from (`clientNet` in `src/domain/deal/net.ts`). A figure is **confirmed** when a paper from whoever sets it says so: the lender's written offer for a financing (its recorded decision, or the offer typed into the deal), and the creditor's own letter for an obligation (the deal item's `confirmed`). Everything else is an **estimate**: a financing counted from the salary and the rules, or held by a lender's ceiling; the lender's admin fee, the taxes on the expected valuation and the costs typed as expected, which no paper in the system confirms yet.

- The net is read as five lines: the mortgage, the personal financing, the obligations the deal settles, the costs, and the office's fee. They add up to the study's own `clientNet` to the riyal on every golden case (the mortgage counts up to the sale price, as the study does).
- The obligations line is confirmed only when every obligation has its letter; with some of them it is an estimate that keeps how much and how many are confirmed (`partly`).
- The fee is as sure as what its percents are counted on: the settlement percent on its items' letters, the finance percent on its base. A fee on `net` is an estimate while any cost is counted.
- A sum is confirmed only when every line is. A sum of both never goes without saying which lines are which (`netWhy` in `src/copy/net.ts`).
- The deduction after the financing is shown beside its cap, always as an estimate: its installments are counted from the rates the study assumes, even on a written offer.

Where it shows:

- On `/deals/[id]`, a badge beside what the client keeps, and the tile "صافي العميل": the lines, each with its source and its badge, and what they come to, with which is which and the deduction. Hidden while the valuation is missing.
- In the client's study message and on their own page, each financing part is said as written when the lender's offer gives it (to the riyal, "بعرض مكتوب من الجهة"), and as near when counted ("نحو …" and "(تقديري)"). What the client keeps is marked the same way. The note under the figures appears only when one of them is an estimate. `ClientFacts` carries each part's certainty and the net's, and nothing of the fee: the fee is in the final offer alone.

Choices the owner has not reviewed: the lender's admin fee counts as an estimate even with a written offer, since the offer's own fee is not recorded; the valuation has no confirmed state, so the taxes on it stay estimates; the client is told a confirmed amount to the riyal.

### Two scenarios side by side

`/deals/[id]/compare` puts the deal as it stands beside a scenario of it, on the same rows (the mortgage, the personal financing, the obligations, the costs, the office's fee, what the client keeps, and the capital the office puts in), with the difference in riyals on each (`src/domain/deal/compare.ts`). A row that is nothing in both is left out.

- A scenario moves a few levers (`Levers`): the structure, the two percents and the finance base, a discount on the court orders and defaults the company settles (`withDiscount`, which also drops their confirmation: a discounted amount is not what the letter says), a lender's offer, and the valuation. Anything not moved stays as the deal has it (`scenarioInput`).
- The levers live in the page's address (`src/server/deals/levers.ts`): anything empty, unknown or out of bounds is left as the deal has it, so a scenario never fails. A scenario can be shared and opened again.
- The page opens on the likeliest scenario: for a deal that does not close, the discount that closes it (from `dealAlternatives`); then the fee at the policy's floor when the deal is above it; then the other structures. These are offered as quick choices above the table, and a form below takes any other.
- The rows are the same lines the client's net is read on, so both columns add up the same way (checked on every golden case). Beneath, the deal as it stands says which of its lines are confirmed.
- A scenario changes nothing and is never offered to the client. Nothing is saved or logged.

## What the office knows about lenders

A lender's terms say what it publishes. `src/domain/knowledge` holds what the office learned beyond them, in two kinds:

- **A note** (`Rule`) is something a person wrote down about one lender or about all of them: a condition no brochure mentions, an exception that worked, a way through, a warning. `rulesFor` gives the notes that bear on one lender for one kind of finance, its own first. `rulesByLender` groups them for the page.
- **A decision** (`DecisionFact`) is what a lender actually answered for one client: yes, yes on other terms, or no, with the amount it approved against what the engine expected, what it asked for (15 codes, `ASKS`) and why it refused (11 codes, `REFUSALS`). `experience` adds them up lender by lender for one kind of finance: how many, how many were a yes, the same for clients like the one asked about (same sector, salary within 35 percent), the average of approved over expected, and what was asked and refused most often. It is locked to the old `lenderExperience` by `npm run golden:experience`: 80 books of made-up decisions, 1,761 in all. The old query returned lenders in whatever order the database read them, so the books are compared lender by lender, and the new order (first appearance) is tested apart.
- `knownFor` picks what bears on one funding route: each part's lender, its record and its own notes, a note said once.

`src/server/knowledge` writes and reads them. `addRule` and `archiveRule` keep a note and take it down (a note is never deleted, only switched off). `recordDecision` records an answer for a deal's client inside one transaction: it reads the client's facts, the credit standing and the engine's estimate from the file as it stands, never from what the screen sent, refuses a part the deal's structure does not have, and, when asked, puts the approved amount on the deal as the lender's offer (`amendDeal`), which a finished deal refuses. Each of the three writes an audit event in the lenders' part of the log. Decisions are stored with the client in `outcomes`; no migration was needed. The old system tied a decision to an application and moved the application's status with it; the rebuild has no applications, so a decision belongs to the deal's client and the deal's stage moves on its own. The rate and the term a lender approved have columns and are not asked for yet: a bridge deal is computed on the amount.

- **`/lenders/knowledge`** ("الخبرة") is the third place under `LendersNav`. It shows what lenders answered for one kind of finance at a time (a stop for each answer, lit for a yes), the last twelve decisions, and the notes lender by lender with a form for a new one. It names no client. Writing a note needs `client.edit`; taking one down needs `lender.manage`.
- **`/deals/[id]/lenders`** shows the same knowledge where it is used: a tile for the best route with its lenders' records and notes, one line under each other route, and a tile where the lender's answer is recorded (`DecisionForm`, `saveDecision`). Recording needs `app.manage`; putting the amount on the deal needs `deal.edit` as well, and the box starts ticked only when the answer comes from the lender the deal is on.
- The rows are shared by both pages (`src/ui/knowledge.tsx`), and the wording is in `src/copy/knowledge.ts`.
- The demo holds three made-up notes and eighteen made-up decisions beside the catalogue's eight starting notes. They show how the screens read and say nothing true about any lender.
- **A written answer.** A decision can name the paper of the client's file that holds the lender's reply (`replyPaperId` on `outcomes`, migration `0013`). Only a paper of that client's own file, received or verified, with a file in it, can (`replyPapers`; anything else is `REPLY_PAPER`). A decision without one is what the employee was told: it is kept and shown, and it confirms nothing. `lenderReplies` reads a client's answers newest first, and an answer is written only while its paper still stands: a paper sent back takes the confirmation with it.

## Opportunities

Every funding route of a deal, read as an opportunity and ranked (`src/domain/opportunity`, `src/server/opportunities`). It is the roadmap's third phase.

- **The class.** `not_viable` when the lender refused in the last three months, a confirmed condition blocks the client, or the deal leaves a deficit. `confirmed` only when every part has a fresh written approval and nothing is missing. `theoretical` when a fact is missing, a refusal is older than three months, or a condition has no source. `ready` otherwise: every condition that applies is met on documented terms and no lender has answered yet. A settled default never moves the class; it carries the warning that paying it guarantees nothing, and each lender's wait.
- **The confidence** is the weakest of what it rests on: each part's conditions and amount, conflicts between the file and a checked paper, and the obligations' letters. Written is high, verbal or estimated is medium, no source is low. The costs are said and not weighed.
- **The figures.** The chosen route is read on the deal as it stands. Every other route is read on its own terms, with the amount a lender approved where one stands. Each card shows the cost, the change to the financing, the office's fee, the client's net with what is confirmed and what is estimated, and the source and date of every assumption.
- **The plan.** The fee plan's print now holds the terms of the chosen route's lenders, so a lender's term changing drops the approval and says so (`planMoves.lenders`). A plan is not approved on a route a lender refused or a confirmed condition blocks (`BLOCKED`).
- **The report** (`makeReport`, table `opportunity_reports`) saves the study as it stands, worked out again on the server, with its day and author. It is refused until the client's consent is recorded (`NO_CONSENT`) or when there is nothing to report. It never changes. Its PDF is the browser's print of its page. It shows the office's fee, so it is for the office and not for the client.
- **A written approval the deal is not counted on** (`approvalsApart`, `approvalNotes` in `src/server/knowledge/service.ts`). A lender's written yes names an amount, and recording it changes the deal only when the person ticks "احسب الصفقة على هذا المبلغ". When a part of the deal is counted on an amount that is none of the written approvals standing for it (written, the lender's latest, within three months), the deal's page says so among its notes and the messages page says it above the composer, with the lender, both amounts and what to do. It is said and never decided: no figure, plan, gate or message changes. It goes quiet when the deal is counted on the approved amount, the paper is sent back, the lender answers again, or the deal ends. In the demo the invented client with the made-up bank's written approval shows it. It came from an outside review of the demo (2026-11-25), which read that file's two nets as a contradiction.
- **Where it shows.** `/deals/[id]/opportunities` (the cards, the classes and the reports), `/deals/[id]/opportunities/reports/[reportId]`, and a section of the client's file with the first five, the chosen plan and its state. In the demo one invented client has a written approval from the made-up bank and another a refusal from the made-up finance company (`seedDemoReplies`).

Choices the owner has not reviewed: a written approval at another amount is a warning and does not close the client's final offer (asked of him on 2026-11-25); a lender's answer holds three months, as a term does; a mortgage amount stays an estimate until a lender's offer, since it rests on the expected valuation; a refusal older than three months caps the opportunity at theoretical rather than barring it; a doubt about an amount term lowers the confidence and not the class.

## Requests to lenders

The office's requests to a lender about one client, from prepared to answered (`src/domain/request`, `src/server/requests`, tables `lender_contacts`, `share_consents` and `lender_requests`). It is the roadmap's fourth phase, the part that sends nothing.

- **The system never sends.** A person copies the approved message, sends it through the lender's own way, and records that it went: which way and which day. There is no automatic sending and no link to any lender's system.
- **A way of reaching a lender** (`lender_contacts`) carries a request only with a source and a check no older than six months (`contactState`). One without a source, unchecked, run out or stopped is kept and says why it carries nothing. A stopped way stays, so what was sent through it still says where. An e-mail, a number and a portal are checked for their shape; a portal must be `https`.
- **The client's consent to sharing** (`share_consents`) is given per lender, in writing or by word, with its day and a note on where it is. It needs the consent to processing on the client's file first (`CONSENT_NEEDED`). The newest one not withdrawn stands. Withdrawing it stops the next step of any request to that lender.
- **Preparing** (`prepareRequest`) is refused, in this order, for an ended deal, a client with no consent to processing, no sharing consent with that lender, no standing approval of the analysis, an opportunity that cannot be carried out, or a request to the same lender still open (`OPEN_REQUEST`, with the open one named). The message is built from the approved file only (`sharedOn`): the file number as reference, the parts and amounts asked for, and the facts a lender studies (nationality, age, sector, contract, service, salaries, the salary's bank, whether the salary is documented, what is left monthly after the settlement, and the record in a few words). It never carries a name, an identity number or a phone. Its print is kept.
- **Approving** is the manager's (`request.approve`). It is refused when the message no longer matches the file (`STALE`), the analysis approval fell, the consent was withdrawn or the opportunity stopped being viable.
- **Sending** is recorded with a usable way of that lender and a day no earlier than the approval and no later than today. What the way was at that moment is kept on the request.
- **The answer** is recorded on the request with the lender's existing decision form: the day it came, the written paper when there is one, and the lender's own words. It updates the opportunity's class as any answer does. A request is answered once every part it asked about has an answer.
- **Following up.** A request sent and unanswered for longer than the office's wait (seven days by default, one to sixty, set by the manager in `office_settings` under `requests`) shows first on `/lenders/requests`.
- **Where it shows.** `/deals/[id]/requests` (what must stand first, each lender of the study once, the consents, and each request on its road), `/lenders/requests` (follow-up first, then open by state, then those ended this month) and `/lenders/contacts`. Every step writes the audit log. In the demo only the two made-up lenders have ways of reaching them, and one invented client has one request on its whole road (`seedDemoContacts`, `seedDemoRequests`).

Choices the owner has not reviewed: only the manager approves a request; a second request to the same lender for the same client is refused while one is open, whatever the product; a request needs the analysis approved as it stands now; a check of a way lasts six months; the wait before following up is seven days; once a lender answered a request, the deal's page points at that answer and offers no new request to it.

## Project studies

Some files are not a salary and a deal. A hotel, a residential or a commercial building asks for finance against its land and what it will earn. `src/domain/project` studies one: `projectStudy(facts, requested)` takes twenty facts (`ProjectFacts`, any of which may be unknown) and the amount asked for, and answers with the ratios a lender looks at first (the request over the land's value, over the whole cost, and the owner's share), a hotel's income against a year of its debt, what stands in the way (`ProjectAlert`, eight kinds, each with a level), the ways it could be financed (`ProjectStructure`, six, each with how well it fits and the amount it could raise when that can be estimated), the papers the file still needs (`ProjectGap`, fourteen, critical or not) and one of four verdicts. It is locked to the old `project.ts` by `npm run golden:project`: 320 generated projects, every ratio, alert, way and paper.

The shares and rates the study uses (a bank's 60 percent of the whole cost, cash against land at 45 percent, a rate of 7.5 percent over ten years for the cover) are estimates from market practice, as the old study used them. They size a first answer. They are named constants at the top of the module, and the wording never presents them as a lender's terms.

Old behaviours kept as they were, each worth a decision before the switch:

- Bank statements, the credit report and a plan for the use of the money are always asked for and always critical. No file starts with fewer than three critical gaps, and four hold the verdict back.
- A borrower nobody described is treated as an individual, and a deed nobody described as one outside the property register. The alert is the same one; the wording says the fact is not known and does not name the worse answer.
- The tourism fund's way shows 60 percent of the whole cost even when that is more than was asked for.

One thing changed on purpose: the old wording named one city and one request's amount in places. The new wording names no city and no amount of its own, and a lender's name stands only under who to ask, never as a promise that it accepts.

**Storage.** A project is a client's file with `financeType` `"project"`, the amount in `requestedAmount` and the facts in `extra`: the same twenty keys the old system kept there as text, so its rows move as they are. `projectFactsOf` reads each value on its own, from an object or from the old text, and what is not what it should be reads as not known. The file has no salary (sector `self`) and no deal. Its papers hang on the client, as every paper does. No migration was needed.

`src/server/projects` opens and changes one. `openProject` opens the owner's file through `createClient`, so the rules of a phone, the file number and the messages a number already wrote are the ones every file has. `saveProject` changes it. Both validate with `projectInputSchema`, where nothing and zero both read as not known. Each writes `project.save` in the clients' part of the log: that the project was new, or the names of the facts that changed, never a value. A save that changes nothing writes nothing. The verdict is not stored: `projectOf` works the study out on every read, so it cannot go stale when a rule changes.

- **`/projects/new`** and **`/clients/[id]/project/edit`** are one form (`ProjectEditor`) in four steps. The study runs in the browser as each number is typed, and the server works it out again on saving. Opening needs `client.create`; changing needs `client.edit`. The dock steps aside on both, as it does for the deal editor.
- **`/clients/[id]/project`** is the study: the verdict with the request drawn against the land's value and the two lines lenders draw at 50 and 70 percent, the three ratios each with the division behind it, a hotel's income one step at a time, what stands in the way with the way out of each, the ways to finance it, what the file still needs, and what is known.
- The list of everyone marks a project's file and shows what it is, where it is and its verdict. The owner's file shows the project in place of a deal. `/projects` leads to the list.
- The wording is in `src/copy/project.ts`. An amount in the millions is said in millions (`millions`, `amountParts` in `src/copy/format.ts`).
- The demo holds one made-up project, a hotel on land in Jeddah. No real land, owner or valuation is in the repository.

**A project's papers.** `/clients/[id]/project/papers` is the same list a deal has, for a file with no deal. `projectPapers` (`src/domain/documents/project.ts`) works out what the file needs from what a lender asks of a project, and from three facts: a company brings its register, its statements, its zakat certificate and the company's own credit report (`simah_company`); an individual is not asked for them, and while nobody said which the owner is they stand as optional. The lien letter is asked for when the land is mortgaged, and the zoning letter when the land is near the Haram. The screens and actions are shared with a deal's papers in `src/app/(app)/_papers`: every action takes a home, `d<dealId>` or `p<clientId>`, and resolves the client and the pages to refresh from it. The rules of a file, of opening one and of judging one are the same.

**A checked paper answers the study.** Eight of the fourteen gaps name a paper (`gapPapers` in `src/domain/documents/gaps.ts`): the deed, the feasibility study, the permit, the valuation, the statements, the credit report, the plan for the money and the zoning letter. Once every paper a gap names is verified, `projectStudy(facts, requested, held)` no longer raises that gap, so the verdict moves on evidence and not on a tick in a form. `projectsOf` reads the checked papers of many files in two queries, and the study, the list of projects, the list of everyone and the editor all read the same answer. A paper that only arrived, or was sent back, closes nothing: the study shows where it stands beside the gap. Removing a file or sending a paper back opens the gap again, because nothing is stored.

**Rejecting a project.** A project has no deal to carry a rejection, so the mark is the file's own `status`. `rejectDeal` and `reopenDeal` already handled a file with no deal: the reason is asked for, kept as a note on the file and written to the log. The owner's file carries the control (`deal.edit`). A rejected file is kept as it stood: `saveProject` refuses with `FILE_REJECTED`, the paper actions refuse, the editor leads back to the study, and the study, the papers and the list all say the file is rejected. Reopening returns it to study with its papers and its facts as they were.

Choices made here that nobody at the office reviewed, each worth a decision before the switch:

- Only a paper someone checked closes a gap. A paper that arrived and waits closes nothing.
- A company's statements gap needs both the bank statements and the audited statements, and its credit gap needs both the owner's report and the company's. An individual needs one of each.
- An individual is not asked for a company's papers, though the study still warns that most lenders want a company.
- The owner brings every paper of a project, the valuation included. In a deal the office orders the valuation.
- A rejected project refuses every change, to its facts and to its papers, until it is reopened.
- Rejecting and reopening a project ask for the same permission as rejecting a deal.

Not built yet for a project: turning a salary file into a project.

## Documents

`src/domain/documents` answers what a client's file needs today and where each paper stands. `src/server/documents` keeps the papers and their files, and `/deals/[id]/documents` is the screen.

- What a file needs is worked out, never stored (`dealPapers`). It starts from what a lender asks for the financing the deal's structure ends in, the mortgage, the personal finance or both, through the same `requiredDocuments` the eligibility engine is locked to. A liability letter is required when the deal settles anything. Then come the papers the deal itself produces, each asked for once the deal reaches the stage that produces it: the signed agreement, the clearance letters for what the company paid, the mortgage payoff letter, and the deed after the property moves to the company's side. A cancelled deal asks for what its history reached.
- A row in `documents` is a paper, one per client and code, and it exists only once something happened to it. A paper holds several files (`document_files`, their contents in `file_blobs`), because a bank statement comes as a handful of photos.
- A paper's state follows its files: none is missing, some is received. A person who may verify (`doc.verify`) says it is good or sends it back with a reason. A new file returns it to received. A paper sent back stays sent back, with its reason, until a new file arrives.
- A person can add a paper by name for what one lender asks for (a medical exam, a letter from the employer). It carries a `custom:` code, counts as required until it is removed, and can be removed only while it is empty.
- The SIMAH report enters only through the credit page, because it is read and not only kept. Its PDF is kept under the `simah` paper, and that paper counts as verified once a credit record exists.
- A file is judged by its own bytes, never by its name or the type the browser claims: PDF, JPEG, PNG or WebP, 4 MB each, 12 to a paper, the same file never twice in one paper. Pictures are made smaller in the browser before they travel, and files go up one request each.
- A file is read through `/files/[id]`, which asks for `client.view_pii`, writes the opening to the audit log, and answers with `private, no-store` and `nosniff`. A person without that permission sees that a file exists and neither its name nor its contents.
- Some papers are the office's to bring: the valuation it orders and the papers the deal produces. `paperSource` marks them, and the message that asks the client for what is owed never names them. That message names papers only: no amounts, no fees, nothing about the deal.
- A build without a database refuses uploads, as it refuses a credit report. The demo carries made-up one-page PDFs that say so on the page.

Worth a decision before the switch: files live in Postgres, so the database grows with every paper. That is sound for a start (one backup holds everything, and a file is never without its row), and a busy year of scans may outgrow a small database plan. Moving the contents to file storage later touches `file_blobs` alone.

## Messages

`src/domain/messages` decides what may be said to a client and what a client may be told. `src/server/messages` keeps the conversation, the client's link and the line to WhatsApp. The screens are `/deals/[id]/messages` for the office and `/s/[token]` for the client.

- A gate decides what may be written (`messageGate`). A cancelled deal and a deal that does not close leave only the internal summary: the client counts as rejected and is not written to. A study still missing facts allows the papers request and a reply. Every other deal allows the study summary, the papers request, where the file stands, a reply in the person's own words, and the internal summary, and, while its fee plan stands approved, the final offer. The same gate opens and closes the client's link.
- The study, papers and progress messages are built from `ClientFacts` alone. That type carries no fee, no capital and no return, so no wording built on it can tell a client what the company earns. The final offer is built from `ClientOffer`, which adds the approved fee in detail and still has no capital and no return (see "The client's final offer"). A test walks all 240 golden deals and checks that every number in a client message is one the client may know. The internal summary carries the company's numbers and is never recorded as said to a client.
- The study message names the kind of lender and the amount. Naming the lender itself is a choice the person makes each time, off by default.
- A client's link is derived, not stored: the token is an HMAC of a random seed under the app's secret, and the row keeps the seed and the token's hash. The office can show the link again at any time, and a copy of the database alone opens nobody's page. A link lasts 14 days and one press closes every link of a client.
- The client's page shows the steps of the road in the client's words, the amounts of the plan rounded, and the client's own papers. Once the fee plan stands approved it shows the final offer instead of the rounded amounts, with the fee in detail, and goes back to them if the approval falls. It never shows the office's papers, the WhatsApp tray, a file, the name of a lender, or what the office puts in or earns. It takes uploads for the client's papers that are still owed, through the same `keepFile` checks as the office, 60 files per client per day.
- WhatsApp from the company's number goes through Meta's Cloud API (`cloud.ts`) and is off until the owner sets `WA_TOKEN` and `WA_PHONE_ID`. Free text is sent only while the client wrote within the last 24 hours. Outside that window the approved template goes instead (`masar_file_update`: first name and link). Until the number is connected a person sends from their own WhatsApp and the message is recorded in the file as sent by hand.
- `/api/wa/webhook` takes what Meta reports. A call is trusted only by its `x-hub-signature-256` under `WA_APP_SECRET`. Delivery reports update the message they belong to, a repeated message is kept once, and a message from a number the office does not know is stored without a client.
- A picture or a document from a known client is kept under the `inbox` paper, the tray at the top of the papers screen. It counts for nothing there. A person opens it and puts it under the paper it is (`movePaperFile`), which is written to the audit log.
- The sign-in code by WhatsApp uses the same line (`codeSender`) and the approved authentication template `masar_login_code`. The form answers with the same words whether the email has an account or not.
- A build without a database sends nothing and records nothing. Its client numbers are invented, so "open in WhatsApp" opens with no number chosen, and its links are fixed so the same link opens on every copy of the demo.

## People and the inbox

`/clients` lists every file, `/clients/[id]` is one person's file, and `/inbox` holds what was written to the company's number. `src/server/clients/directory.ts` reads the first two and `src/server/messages/inbox.ts` the third.

- A file's state is the stage of its newest deal (`fileState`): at a station of the road, completed, rejected, or a file with no deal. The list shows the file that moved last first, and its search looks at the name, the employer and the file number. A phone is searched only for a person who may see one (`client.view_pii`). Letters that are written more than one way are read as one (`foldText`).
- A phone is kept in one form, `9665` and eight digits, and belongs to one file. Saving a number another file holds is refused, and the refusal names that file. A file takes what its number wrote before it was on the file (`adoptMessages`).
- An identity number is ten digits, starts with 1 for a citizen and 2 for a resident, and its last digit is a check digit (`idProblem`). It belongs to one file too. The audit log records which fields of a contact changed and never their values.
- The decision on a file is taken from the file itself: rejecting it, or putting a rejected file back under study, each with a reason of at least three letters that stays on the file as a note. Rejection closes the client's link, as before.
- A client whose last deal ended can get another on the same file (`startDealFor`). A deal in progress refuses a second one, and a rejected file goes back under study with the new deal.
- A conversation waits when its last message came in and nobody has dealt with it (`wa_messages.seen_at`, migration `0005_inbox_seen`). Answering ends the wait, and so does saying it needs no answer (`markHandled`), which is written to the audit log. The dock carries the count of waiting conversations for a person who may read them.
- A number the office does not know has three ways out: open a file for it (the new deal form arrives with the number and the name WhatsApp gave), say it is an existing client's number (`claimNumber`: it replaces that client's phone and its messages join the file), or say it needs no answer.
- The inbox and a stranger's messages ask for `client.view_pii`. A person without it does not see the place in the dock.
- The demo has six files (four on the road, one completed, one rejected) and one unknown number with two messages.

## The office: accounts and the audit log

`/users` is everyone who may enter the system and `/audit` is everything that happened in it. Both are for the admin alone (`user.manage`, `audit.view`). The dock keeps its five places: a person who holds either permission finds the two doors in a tile on `/account`, and nobody else sees it.

- **Accounts.** `src/server/auth/users.ts` makes an account (`createUser`), changes a role, the sign-in mobile or whether the account works (`updateUser`), gives a new password to a person who lost theirs (`resetPassword`), leaves a person who lost their phone with the password as their only way in (`resetSignIn`), and lifts a lock (`unlockUser`). `listUsers` reads the list with each person's ways in, last sign-in, open sessions and lock.
- **The password is asked first.** Every one of those changes needs a session whose person typed their password within the last ten minutes, the same rule as a change to one's own ways in. The services check it themselves (`requireManagerConfirmed`), so a new screen or action cannot skip it; an action only hands over the session cookie. What was typed is checked before the password is asked for, and nothing is read or said about another account before it is given. The script that makes the first account acts as the system and has no session to confirm.
- **Nobody locks themselves out.** A person cannot change their own role or stop their own account, so the office always has an admin who can act. A new password and a reset of ways in for one's own account belong to `/account`, where the current password is asked, and are refused here (`OWN_ACCOUNT`). One's own sign-in mobile can be set.
- **Stopping is immediate.** A stopped account's sessions end in the same transaction, and so do the sessions of an account whose password or ways in were reset. A role change applies to open sessions on their next request, because the role is read from the account each time.
- **The log.** `src/domain/audit` lists every event the system writes, in seven parts of the office (sign-in, accounts, clients, deals, papers, messages, lenders). `tests/domain/audit.test.ts` reads the source of `src/server` and fails when a service writes an event the list does not know or the list holds one nothing writes, so the log's wording cannot fall behind the code. `src/server/audit/log.ts` reads the log newest first, sixty lines a page, with the doer and what the event was about (a deal, a client, an account, a paper), and still reads a line whose subject is gone.
- **What deserves a look.** A failed sign-in, a private file that was opened, and every change to who may enter (`WATCHED_ACTIONS`). The screen marks those lines and offers them as one choice beside the seven parts and the choice of a person. A failed sign-in shows the address it came from.
- **Words, not values.** `src/copy/audit.ts` turns an event and its details into a sentence. A detail names what changed (the role, the mobile) and never holds a private value: no phone, no identity number, nothing typed at the door. The choices of the screen live in the address, and anything else typed there reads as no choice.
- **The demo office** has five fictional people (one of them stopped) and a log of its own work, laid over office hours in the order the work happened. A build without a database refuses every change to an account (`DEMO`).

## The office's month

`/reports` is one page for the manager (`audit.view`, as the audit log, since it names clients and their fees), reached from the account page beside the accounts, the log and the fee policy. It came from an outside review of the demo (2026-11-25) that asked for management reports; it adds nothing to enter and changes nothing that exists.

- **What it counts** (`monthReport` in `src/domain/report`, `monthView` in `src/server/reports/service.ts`). For one month in Riyadh: the deals opened (the day a deal's first stage was recorded, as its page counts it), closed and lost (the day it entered that stage), the closed deals' fees and the average days from opening to closing, each lender's answers (approvals, refusals, how many in writing), and the requests sent and answered, with those waiting now said only of the current month.
- **A fee as counted, never as collected.** A closed deal's fee is its fee as the deal was last counted. What the office actually collected is not recorded; the page says so, and recording it waits on the owner (asked of him on 2026-11-25).
- **The months** run from the month of the first deal to the current one, so the page never offers an empty past or a future month. An address with another month falls back to the current one.

`tests/domain/report.test.ts` holds the counting, `tests/copy/report.test.ts` the wording, and `tests/server/demo.test.ts` the demonstration's closed deal in September and lost one in October.

Choices the owner has not reviewed: the manager alone sees it; a deal counts in the month its study began and the month it ended; an answer recorded with a paper counts as written even if the paper is later sent back; the average and not the middle value.

## The database underneath

Tests and the demo run on PGlite, a Postgres that lives inside the process, so neither needs a server. The live site talks to a Postgres server through `postgres.js`. The two drivers hand some things back differently (a raw statement's rows, a large number, a file's bytes), so the whole suite also runs in CI against a Postgres server through the live driver: `tests/helpers/db.ts` makes a fresh database per test on the server named by `MASAR_TEST_DATABASE_URL` and drops it afterwards. A server that is not on the same machine is only ever reached over TLS.

On Vercel the build is `npm run vercel-build`: `scripts/release.ts before`, `next build`, `scripts/release.ts after`. A production build refuses to go on without `MASAR_DATABASE_URL`, `MASAR_SECRET` and `MASAR_ORIGINS`, applies pending migrations before the build, and afterwards refuses to go live with no account to sign in to. `planRelease` in `src/server/port/release.ts` decides, and a preview does none of it.

## Porting checklist

Old module (under `legacy/lib`) and its state in the rebuild:

- [x] `deal.ts` study, structures, fees, alternatives: `src/domain/deal`, locked by `tests/golden/deal.json` (240 cases)
- [x] loan math and SAMA constants from `engine.ts`: `src/domain/finance`
- [x] `deal.ts` `itemsFrom` (deal items from a credit report): `itemDrafts` in `src/domain/deal/from-credit.ts`, locked by `tests/golden/credit.json`
- [x] `engine.ts` eligibility, lender matching, required documents: `src/domain/eligibility`, locked by `tests/golden/eligibility.json` (400 clients against the seeded catalogue and against products with unusual terms, 2,286 matches, and the document lists of all 84 kinds of client)
- [x] `simah.ts` credit grading: `src/domain/credit`, locked by `tests/golden/credit.json` (320 records)
- [x] `simah-parse.ts` reading the report's text: `src/domain/credit/parse.ts`, locked by `tests/golden/simah.json` (160 made-up texts)
- [x] storing a client's credit report, the upload of the PDF, the Najiz check and the credit screen: `src/server/credit`, `/clients/[id]/credit`
- [x] keeping the uploaded PDF with the client's documents: `keepFile` under the `simah` paper
- [x] importing commitments from a report (`uploadSimah`), and suggesting a new deal's items from it in the editor: `owedFrom`, `reportDrafts`, `pendingDrafts` in `src/domain/deal/from-credit.ts`, reviewed in the deal editor before anything is saved
- [x] `project.ts` project finance: `src/domain/project`, `src/copy/project.ts`, `src/server/projects`, locked by `tests/golden/project.json` (320 projects); the screens `/projects/new`, `/clients/[id]/project`, `/clients/[id]/project/edit`
- [x] `advisor.ts` hidden conditions and ways to a larger amount: `src/domain/eligibility/advisor.ts`, `src/copy/advisor.ts`, locked by `tests/golden/advisor.json` (360 clients). Its alerts from a credit report were left to the credit record screen
- [x] `whatsapp.ts`, `wa-cloud.ts` messages and Meta Cloud API: `src/domain/messages`, `src/copy/messages.ts`, `src/server/messages`, `/deals/[id]/messages`, `/api/wa/webhook` (migration `0004_messages_links`)
- [x] `auth.ts`, `totp.ts` sign-in with a password, sessions, roles and permissions, lockouts, the authenticator as a second step and as a code: `src/domain/auth`, `src/server/auth`, the `/login` screen
- [x] `auth-methods.ts` passkeys, enrolling an authenticator, changing a password and signing other devices out: `src/server/auth/passkeys.ts`, `account.ts`, the `/account` screen
- [x] `auth-methods.ts` delivery of the WhatsApp code: `codeSender` in `src/server/messages/request.ts`, asked for on `/login`
- [x] `schema.ts`, `db.ts`: replaced by `src/server/db` (Drizzle schema, `db/migrations`, Postgres schema `masar`)
- [x] deal storage and stages from `data.ts` and `actions.ts`: `src/server/deals` (save, stage, reject, reopen, read), tested on a real Postgres engine in memory
- [x] the lender catalogue and its terms: `src/server/lenders`, the `/lenders` page; funding routes for a deal: `src/domain/funding`, `src/server/funding`, `/deals/[id]/lenders` (migration `0002_lender_routes`)
- [x] a client's papers and their files from `data.ts` and `actions.ts`: `src/domain/documents`, `src/server/documents`, `/deals/[id]/documents`, `/files/[id]` (migration `0003_documents_files`)
- [x] clients, their contact details and notes from `data.ts` and `actions.ts`: `src/domain/clients`, `src/server/clients` (`directory.ts`, `updateContact`, `addNote`), `/clients`, `/clients/[id]`
- [x] the inbox and numbers the office does not know: `src/server/messages/inbox.ts`, `/inbox`, `/inbox/[phone]` (migration `0005_inbox_seen`)
- [x] lender rules and recorded outcomes from `data.ts` and `actions.ts` (`lenderExperience`, `lenderRules`, `recordOutcome`, `addLenderRule`, `archiveLenderRule`): `src/domain/knowledge`, `src/server/knowledge`, locked by `tests/golden/experience.json` (80 books, 1,761 decisions)
- [x] the rest of `data.ts` and `actions.ts`, keeping the catalogue (`saveProduct`: a new lender, a new product, its terms, and the box for a product in use): `src/server/lenders/service.ts` (`addLender`, `addProduct`, `updateProductTerms`, `setProductActive`), the forms on `/lenders`
- [x] screens on the "الخريطة" direction: the road (home), the deals list, the deal file with stage moves and the step by step calculation, the deal editor
- [x] opening a client file and revising its facts, from `data.ts` and `actions.ts`: `src/server/clients`
- [x] the client portal, where the client follows their file and uploads their own papers: `/s/[token]`, `src/server/messages/portal.ts`
- [x] screens: clients, a client's file, the inbox
- [x] managing accounts from `auth.ts` and `actions.ts`, and the audit log: `src/server/auth/users.ts`, `src/domain/audit`, `src/server/audit`, `/users`, `/audit`
- [x] the calculator: `src/domain/eligibility/quick.ts`, `src/copy/calculator.ts`, `/lenders/calculator`
- [x] the knowledge screen and a lender's decision on a deal: `/lenders/knowledge`, the knowledge and decision tiles on `/deals/[id]/lenders`
- [x] new, not a port: a client's credit and financial analysis from the SIMAH record, the file and the catalogue, with the client's consent: `src/domain/analysis`, `src/copy/analysis.ts`, `src/server/analysis`, `/clients/[id]/analysis`
- [x] new, not a port: a lender's special conditions and a client's answers to them: `src/domain/eligibility/special.ts`, `src/server/lenders/service.ts`, `src/server/clients/conditions.ts`, `/lenders`, `/clients/[id]/conditions`
- [x] new, not a port: the file held against its checked papers: `src/domain/documents/facts.ts`, `src/domain/eligibility/conflict.ts`, `src/server/documents/facts.ts`, `/deals/[id]/documents`
- [x] the tool that moves the old tables' data into this system's, its rehearsal, and the deployment steps that run them: `src/server/port`, `scripts/port-data.ts`, `scripts/release.ts`, described in [MIGRATION.md](MIGRATION.md)
- [ ] the rehearsal on the live database, then the move and the switch (each only after the owner approves)

To regenerate a golden file while `legacy/` still exists: `npm run golden:deal`, `npm run golden:credit`, `npm run golden:simah`, `npm run golden:eligibility`, `npm run golden:advisor`, `npm run golden:experience`, `npm run golden:project`. Each generator is seeded, so it writes the same file every time.
