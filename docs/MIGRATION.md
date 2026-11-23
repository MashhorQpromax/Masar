# Moving from the old system

The old application and this one can live in the same Postgres database. The old one keeps its tables in the schema `public`, in the shapes SQLite gave them. This one keeps its own in the schema `masar`. The move reads the first and fills the second. It never changes an old table, so the old system stays whole beside the new one and is what the site falls back to.

Nothing here has been run on the live database. Each step below that touches it waits for the owner's word.

## What moves

Everything keeps the id it had, so a deal, a client or a file is found under the number people already know.

| Old table | What becomes of it |
| --- | --- |
| `users`, `passkeys` | Accounts as they are: the same password, the same authenticator, the same passkeys. An authenticator's secret opens only with the `MASAR_SECRET` the old system runs on, and the move checks that it does. |
| `lenders`, `products`, `lender_rules`, `applications`, `outcomes` | The catalogue and what the office learned, as the office left them. |
| `clients`, `obligations`, `notes`, `studies` | Client files, with the consent the old system recorded when the file was opened. A file with no consent on it is named in the report, and the analysis asks for it. |
| `documents`, `file_blobs` | One paper per kind for each client, with every stored file under it. Each file is read and held against the fingerprint stored with it. A paper that was only asked for and never arrived is not carried: this system works out what a file needs when it shows it. A file that came by WhatsApp goes under the inbox paper. A paper checked in the old system comes over checked with no figure written from it, so it proves no salary until someone writes the salary it states. |
| `credit_reports` | Every reading, tied to the file it was read from. The grade is worked out on read, as for any record. |
| `deals` | The numbers go through the same checks as a deal typed in today, and the figures are worked out again by this engine. The report shows the stored figures beside the new ones for every deal. The road a deal travelled becomes its stage events. |
| `wa_messages` | The conversation, with the file a message brought. Inbound messages come over as waiting. |
| `audit_log` | Every line, under this system's names. An event with no like here is kept and shown as an event of the old system. The move adds one line of its own. |

Left behind on purpose:

- `sessions`, `login_codes`: they live for hours. Everyone signs in once more after the switch.
- `share_links`: the old system kept a link's token as it was sent, and this one keeps only its hash. Open links stop opening at the switch. The report lists the file numbers they belong to, and the office sends each client a new link from the messages page.

## What the tool refuses

The move writes into an empty database only, in one transaction: all of it or none. It stops, and says why, when a file does not match its fingerprint, when a deal's numbers do not pass this system's checks, when a stored credit record does not read, when two accounts share an email, when an authenticator secret does not open, or when any new table already holds a row. Before the transaction closes it counts every new table against what was meant to go into it and reads the old tables once more: a move whose source changed while it ran is undone.

The report names rows by their ids and nobody by name, and an error is logged without the statement that failed, because a statement carries its values.

## Where it runs

The site is deployed by pushing to GitHub, and nobody holds a terminal that reaches the live database. So the steps that need the database are steps of the deployment (`npm run vercel-build`, decided in `src/server/port/release.ts`), and a step that fails stops the deployment: the site that is live stays live. The report is in the deployment's build log, which only the project's members can open.

| Deployment | Before the build | After the build |
| --- | --- | --- |
| A preview of any branch | nothing | nothing |
| A preview of the branch `rehearsal` | rehearses the move | nothing |
| Production | checks the settings, applies migrations | moves the old data when told to, and refuses to go live with no account |

With a terminal that does reach a database, the same three things are `npm run data:port -- --rehearse`, `npm run data:port` (a dry run) and `npm run data:port -- --write`.

## 1. The rehearsal

A rehearsal runs the whole move into a database that is thrown away. It reads the old tables inside a read-only transaction, where Postgres itself refuses a write, makes an empty copy of the new tables in a temporary folder, writes everything into it, and deletes it. It finds what a dry run cannot: a row that breaks a rule of the new tables.

To run it, push the branch to be released under the name `rehearsal`:

```
git push origin revamp:rehearsal
```

The preview build of that branch reads the old database by the name the old system reads it by (`DATABASE_URL` or `POSTGRES_URL`, or `LEGACY_DATABASE_URL` when set for that branch). The preview itself still runs on invented data: it is never given `MASAR_DATABASE_URL`. Read the lines marked `[release]` in the build log:

- `REHEARSED` and an empty "In the way" list: the move will go through.
- Each deal's line shows the figures the old system stored beside this engine's. A deal marked `DIFFERS` is looked at with the owner before the switch.
- "Worth reading" lists what changes on the way.

Delete the branch afterwards. Rehearse again on the day of the switch, close to it.

## 2. The switch

Pick an hour when nobody is working, and tell the office to stay out of the old site until the new one is up.

1. In Vercel, for Production only, set:
   - `MASAR_DATABASE_URL`: the same connection string the old system uses.
   - `MASAR_ORIGINS`: `https://masarfin.com,https://www.masarfin.com`. Passkeys are bound to the first address.
   - `MASAR_MOVE_OLD_DATA`: `yes`.
   - `MASAR_SECRET` is already there and must not change: it opens the authenticator secrets.
   - The `WA_*` settings stay as they are.
2. Merge the pull request into `main`. The production build then:
   - refuses to go on if a setting above is missing,
   - applies the migrations, which make the schema `masar`,
   - builds the site,
   - moves the data. If anything stands in the way the build fails, nothing is written, and the old site stays up.
3. When the deployment is live, sign in with an existing account and open a deal, a client's papers and one stored file.
4. Deploy once more (Redeploy in Vercel). Its log says `ALREADY MOVED` and whether the old tables changed since. "The old tables are as they were" closes the switch.

If that last check lists changes and nobody has worked in the new system yet, something was saved in the old site after the move. Drop the schema `masar` and deploy again: the move runs afresh. If people have already worked in the new system, the lines name the tables, and what was added there is entered by hand.

## Going back

The old tables are untouched and the previous deployment is still on Vercel. Promote it again (Instant Rollback) and the old site is back as it was at the moment of the switch. What people entered in the new system after the switch is not in the old one, so going back is clean only before real work starts, and a decision after that.

## Afterwards

- Remove `MASAR_MOVE_OLD_DATA` once the switch is closed. Leaving it is harmless: a move that was made is not made again.
- The old tables stay until the owner says otherwise. When they go, `legacy/`, `src/server/port`, `scripts/port-data.ts` and the move's steps in `scripts/release.ts` go with them.

## What the tests hold

`tests/server/port.test.ts` builds an old database with the old system's own schema, fills it with invented people, and holds every claim above: what a dry run reports, each refusal, the move table by table read back through this system's services, the second run, the old system used after the move, a source that changes mid-move, the rehearsal, the wording of an error, and what each kind of deployment does. The whole test suite also runs in CI on a Postgres server through the driver the live site uses (`MASAR_TEST_DATABASE_URL`).
