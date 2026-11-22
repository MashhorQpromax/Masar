# Masar v2 architecture

Masar runs a financing brokerage whose core business is the "settle and refinance" deal: the company pays a client's enforcement orders, defaults and mortgage payoff, holds the property as security, and recovers its capital plus a fee from the client's new bank financing. The numbers are real money, so correctness comes before everything else.

This branch is a rebuild from zero. The live site stays on `main` and its database is not touched from here.

## Layout

```
src/
  domain/      Pure business rules. No database, no clock, no network, no text in any language.
    shared/    Rounding and small numeric helpers.
    finance/   SAMA constants and loan math (installments, principal, payoff, pension).
    deal/      The settle-and-refinance engine: structures, study, risks, ledger, alternatives.
  server/      Everything that touches the outside world (database, auth, WhatsApp). Server only.
  app/         Next.js routes. Thin: read through services, render, call server actions.
  ui/          Design system for the "الخريطة" identity.
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
- [ ] `schema.ts`, `db.ts`, `data.ts`: replaced by `src/server/db` with versioned migrations
- [ ] screens, on the "الخريطة" direction
- [ ] data migration from the live database, then the domain switch (only after the owner approves)

To regenerate a golden file while `legacy/` still exists: `npm run golden:deal`.
