import Link from "next/link";
import { attention, glance, nextAction, STATION } from "@/copy/deal";
import { countedInWords, dueIn, inDays, isLate } from "@/copy/format";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { roadView, type RoadDeal } from "@/server/deals/views";
import { Num } from "@/ui/Num";
import { Road, type RoadToken } from "@/ui/Road";

export const dynamic = "force-dynamic";

const DEALS = { one: "صفقة واحدة", two: "صفقتان", few: "صفقات", many: "صفقة" };

/** One token per station: the deal that needs attention most, and how many others stand with it. */
function tokensOf(deals: RoadDeal[], nearestId: number | null): RoadToken[] {
  const byStation = new Map<string, { deal: RoadDeal; tone: RoadToken["tone"]; text: string }[]>();
  for (const deal of deals) {
    const { tone, text } = glance(deal, deal.dealId === nearestId);
    byStation.set(deal.station, [...(byStation.get(deal.station) ?? []), { deal, tone, text }]);
  }
  return [...byStation.values()].map((group) => {
    const [first, ...rest] = group.sort(
      (a, b) => attention(a.tone) - attention(b.tone) || (a.deal.stageDueInDays ?? 999) - (b.deal.stageDueInDays ?? 999),
    );
    return {
      station: first!.deal.station,
      href: `/deals/${first!.deal.dealId}`,
      name: first!.deal.clientName,
      text: first!.text,
      tone: first!.tone,
      more: rest.length,
      moreHref: "/deals",
      moreLabel: `${countedInWords(rest.length, DEALS)} أخرى في محطة ${STATION[first!.deal.station]}`,
    };
  });
}

export default async function HomePage() {
  await requireActor();
  const { portfolio, deals } = await roadView(await getDb(), new Date());
  const byId = new Map(deals.map((d) => [d.dealId, d]));
  const nearest = portfolio.nearest ? byId.get(portfolio.nearest.dealId) : undefined;
  const next = portfolio.next ? byId.get(portfolio.next.dealId) : undefined;

  if (!deals.length) {
    return (
      <>
        <div className="head">
          <div>
            <h1 className="title">الطريق خالٍ</h1>
            <p className="lede">لا صفقات مفتوحة الآن.</p>
          </div>
        </div>
        <Road labels={STATION} tokens={[]} description="طريق الصفقة من الدراسة إلى الصرف، ولا صفقات عليه الآن" />
      </>
    );
  }

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">{countedInWords(deals.length, DEALS)} على الطريق</h1>
          {nearest && nearest.daysToDisbursement != null && (
            <p className="lede">
              أقربها إلى الصرف <b>{nearest.clientName}</b>، {inDays(nearest.daysToDisbursement)}.
            </p>
          )}
        </div>
        <dl className="pills">
          <div className="pill">
            <dt>رأس مال موظّف</dt>
            <dd>
              <Num value={portfolio.capitalOut} />
            </dd>
          </div>
          <div className="pill">
            <dt>أتعاب متوقعة</dt>
            <dd>
              <Num value={portfolio.expectedFees} />
            </dd>
          </div>
          <div className="pill">
            <dt>يعود خلال {portfolio.horizonDays} يوماً</dt>
            <dd>
              <Num value={portfolio.returningSoon} />
            </dd>
          </div>
        </dl>
      </div>

      <div className="roadwrap">
        <Road
          labels={STATION}
          tokens={tokensOf(deals, nearest?.dealId ?? null)}
          description={`طريق الصفقة من الدراسة إلى الصرف، وعليه ${countedInWords(deals.length, DEALS)}`}
        />
        {next && (
          <section className="next" aria-label="التالي الآن">
            <div className="next-text">
              <p className="next-label">التالي الآن</p>
              <h2 className="next-title">{nextAction(next)}</h2>
              <p className="next-meta" data-late={next.stageDueInDays != null && isLate(next.stageDueInDays)}>
                {next.clientName}
                {next.stageDueInDays != null && ` · ${dueIn(next.stageDueInDays)}`}
              </p>
            </div>
            <Link className="next-go" href={`/deals/${next.dealId}`}>
              افتح الملف
            </Link>
          </section>
        )}
      </div>
    </>
  );
}
