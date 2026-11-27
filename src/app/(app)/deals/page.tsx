import type { Metadata } from "next";
import Link from "next/link";
import { glance, STAGE, STATION } from "@/copy/deal";
import { countedInWords, initial, ltr } from "@/copy/format";
import { STATIONS, stationsFor } from "@/domain/deal";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { roadView } from "@/server/deals/views";
import { Num } from "@/ui/Num";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الصفقات · مسار" };

const DEALS = { one: "صفقة واحدة", two: "صفقتان", few: "صفقات", many: "صفقة" };
const ORDER = STATIONS.map((s) => s.key);

export default async function DealsPage() {
  await requireActor();
  const { portfolio, deals } = await roadView(await getDb(), new Date());
  // Furthest along the road first.
  const sorted = [...deals].sort((a, b) => ORDER.indexOf(b.station) - ORDER.indexOf(a.station));

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الصفقات</h1>
          <p className="lede">{deals.length ? `${countedInWords(deals.length, DEALS)} مفتوحة، الأقرب إلى الصرف أولاً.` : "لا صفقات مفتوحة الآن."}</p>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="empty">
          <p className="text-body">تظهر الصفقات هنا عند فتحها.</p>
        </div>
      ) : (
        <div className="rows">
          {sorted.map((deal, index) => {
            const { tone, text } = glance(deal, deal.dealId === portfolio.nearest?.dealId);
            const stations = stationsFor(deal.structure);
            const position = stations.indexOf(deal.station);
            return (
              <Link key={deal.dealId} className="row" href={`/deals/${deal.dealId}`} style={{ animationDelay: `${index * 0.06}s` }}>
                <span className="row-who" data-tone={tone}>
                  <span className="avatar" aria-hidden="true">
                    {initial(deal.clientName)}
                  </span>
                  <span>
                    <b>{deal.clientName}</b>
                    <small className="num">{deal.fileNo}</small>
                  </span>
                </span>
                <span>
                  <span className="dots" role="img" aria-label={`المحطة ${ltr(position + 1)} من ${ltr(stations.length)}`}>
                    {stations.map((key, i) => (
                      <i key={key} data-state={i < position ? "done" : i === position ? "current" : undefined} />
                    ))}
                  </span>
                  {STATION[deal.station]}
                  <small>{STAGE[deal.stage]}</small>
                </span>
                <span>
                  <small>رأس المال</small>
                  <span className="row-figure">{deal.capital != null ? <Num value={deal.capital} /> : "-"}</span>
                </span>
                <span>
                  <small>أتعابنا</small>
                  <span className="row-figure">{deal.fee != null ? <Num value={deal.fee} /> : "-"}</span>
                </span>
                <span className="row-state" data-tone={tone}>
                  {text}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
