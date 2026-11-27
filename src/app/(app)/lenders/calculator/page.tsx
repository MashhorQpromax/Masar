import type { Metadata } from "next";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { QUICK_FINANCE_TYPES, type QuickFinanceType } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listProducts } from "@/server/lenders/service";
import { LendersNav } from "../LendersNav";
import { Calculator } from "./Calculator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الحاسبة · مسار" };

/**
 * A first answer for someone on the phone with a client. Everyone who works in the office may ask,
 * the engine runs in the browser on the lenders' terms, and nothing typed here is sent or kept.
 */
export default async function CalculatorPage() {
  await requireActor();
  const products = (await listProducts(await getDb())).filter((product) => (QUICK_FINANCE_TYPES as readonly string[]).includes(product.financeType));
  const kinds = QUICK_FINANCE_TYPES.filter((kind) => products.some((product) => product.financeType === kind));
  const options = Object.fromEntries(kinds.map((kind) => [kind, FINANCE_TYPE[kind]])) as Record<QuickFinanceType, string>;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الحاسبة</h1>
        </div>
        <div className="head-side">
          <p className="where">
            تقدير أولي على شروط الجهات · <b>لا يُحفظ ما تكتبه</b>
          </p>
        </div>
      </div>
      <LendersNav current="/lenders/calculator" />

      {kinds.length ? (
        <Calculator products={products} kinds={options} first={kinds[0]!} />
      ) : (
        <section className="empty">
          <h2>لا جهات في القائمة</h2>
          <p>تُحسب التقديرات على شروط الجهات. أضفها أولاً من صفحة الشروط.</p>
        </section>
      )}
    </>
  );
}
