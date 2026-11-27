import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPARE_ROW, diffText, PRESET, scenarioText, SIDE, WHAT_IF } from "@/copy/compare";
import { VERDICT } from "@/copy/deal";
import { netWhy } from "@/copy/net";
import {
  clientNet,
  compareScenarios,
  dealAlternatives,
  dealStudy,
  movedLevers,
  normalizeFee,
  scenarioFigures,
  scenarioInput,
  STRUCTURE_KEYS,
  structureOf,
  type Levers,
} from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { leversQuery, parseLevers } from "@/server/deals/levers";
import { borrowerOf } from "@/server/deals/mapping";
import { getDeal } from "@/server/deals/service";
import { feePolicy } from "@/server/settings/fees";
import { Certain } from "@/ui/Certain";
import { BackIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { ScenarioForm } from "./ScenarioForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "قارن سيناريو · مسار" };

/**
 * The deal as it stands beside a scenario of it, on the same rows, with the difference in riyals on
 * each. A scenario moves a few levers and changes nothing of the deal.
 */
export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor();
  const dealId = Number((await params).id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();
  const now = new Date();
  const db = await getDb();
  const view = await getDeal(db, { dealId, now });
  if (!view) notFound();
  const { client, input, study } = view;
  const borrower = borrowerOf(client, now);

  // The quick scenarios, the likeliest first: a discount that closes a deal that does not, the fee at the
  // policy's floor, then the other structures.
  const fee = normalizeFee(input.fee);
  const policy = await feePolicy(db);
  const structure = structureOf(input);
  const presets: { text: string; levers: Levers }[] = [
    ...dealAlternatives(input, borrower, view.creditFlags).flatMap((alt) =>
      alt.code === "DISCOUNT_CLOSES" && alt.tone !== "no" ? [{ text: PRESET.discount(Number(alt.params.pct)), levers: { discountPct: Number(alt.params.pct) } }] : [],
    ),
    ...(fee.settlePct > policy.min || fee.financePct > policy.min ? [{ text: PRESET.feeMin(policy.min), levers: { settlePct: policy.min, financePct: policy.min } }] : []),
    ...STRUCTURE_KEYS.filter((key) => key !== structure).map((key) => ({ text: PRESET.structure(key), levers: { structure: key } })),
  ];

  // With nothing asked, the page opens on the likeliest scenario rather than on the deal beside itself.
  const asked = parseLevers(await searchParams);
  const levers = Object.keys(asked).length > 0 ? asked : (presets[0]?.levers ?? {});
  const inputB = scenarioInput(input, levers);
  const studyB = dealStudy(inputB, borrower, view.creditFlags);
  const a = scenarioFigures(input, study);
  const b = scenarioFigures(inputB, studyB);
  const rows = compareScenarios(a, b);
  const moved = movedLevers(input, levers);
  const net = clientNet(input, study);
  const here = leversQuery(levers);

  return (
    <>
      <div className="head">
        <div>
          <Link className="back" href={`/deals/${dealId}`}>
            <BackIcon />
            {client.fullName}
          </Link>
          <h1 className="title">قارن سيناريو</h1>
        </div>
      </div>

      <div className="bento">
        <section className="tile tile--wide cmp">
          <div className="cmp-head">
            <div>
              <p className="label">{SIDE.b}</p>
              <h2>{scenarioText(moved, levers)}</h2>
            </div>
            {presets.length > 0 && (
              <nav className="cmp-presets" aria-label="سيناريوهات جاهزة">
                {presets.map((preset) => {
                  const query = leversQuery(preset.levers);
                  return (
                    <Link key={preset.text} className="chip" href={`/deals/${dealId}/compare${query}`} aria-current={query === here ? "true" : undefined} scroll={false}>
                      {preset.text}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="cmp-table" role="table" aria-label={`${SIDE.a} و${SIDE.b}`}>
            <div className="cmp-row cmp-row--head" role="row">
              <span role="columnheader" />
              <span role="columnheader">
                {SIDE.a}
                <small>{VERDICT[a.verdict]}</small>
              </span>
              <span role="columnheader">
                {SIDE.b}
                <small>{VERDICT[b.verdict]}</small>
              </span>
              <span role="columnheader">{SIDE.diff}</span>
            </div>
            {rows.map((row) => (
              <div key={row.row} className="cmp-row" role="row" data-row={row.row}>
                <span role="rowheader">{COMPARE_ROW[row.row]}</span>
                <span role="cell" data-deficit={row.row === "clientNet" && row.a < 0}>
                  <Num value={row.a} />
                </span>
                <span role="cell" data-deficit={row.row === "clientNet" && row.b < 0}>
                  <Num value={row.b} />
                </span>
                <span role="cell" className="cmp-diff" data-sign={Math.sign(row.diff)}>
                  {row.diff === 0 ? diffText(0) : <span className="num">{diffText(row.diff)}</span>}
                </span>
              </div>
            ))}
          </div>

          <p className="cmp-foot">
            <b>{SIDE.a}</b>
            <Certain value={net.certainty} />
            <span>{netWhy(net)}</span>
          </p>
          <p className="cmp-foot">{WHAT_IF}</p>
        </section>

        <details className="tile tile--wide cmp-own" open={moved.length > 0 && presets.every((preset) => leversQuery(preset.levers) !== here)}>
          <summary>غيّر السيناريو بنفسك</summary>
          <ScenarioForm
            key={here}
            dealId={dealId}
            levers={levers}
            start={{
              structure,
              settlePct: fee.settlePct,
              financePct: fee.financePct,
              financeBase: fee.financeBase,
              bankMortgage: input.bankMortgage,
              bankPersonal: input.bankPersonal,
              propertyValue: input.propertyValue,
              estimate: { mortgage: study.financing.mortgage, personal: study.financing.personal },
            }}
          />
        </details>
      </div>
    </>
  );
}
