import type { Metadata } from "next";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { counted, months, percent } from "@/copy/format";
import { afterDefaultText, LENDER_TYPE, LENDERS, PRODUCTS, RATE_TYPE } from "@/copy/lenders";
import { can } from "@/domain/auth";
import type { Product } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listCatalogue } from "@/server/lenders/service";
import { ChevronIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { LendersNav } from "./LendersNav";
import { ProductForm } from "./ProductForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الجهات · مسار" };

const termsOf = (p: Product) => ({
  rate: p.rate,
  rateType: p.rateType,
  maxAmount: p.maxAmount,
  maxTenor: p.maxTenor,
  maxAgeAtMaturity: p.maxAgeAtMaturity,
  minSalary: p.minSalary,
  minServiceMonths: p.minServiceMonths,
  maxLtv: p.maxLtv ?? null,
  requiresSalaryTransfer: p.requiresSalaryTransfer,
  acceptsLateSimah: p.acceptsLateSimah,
  settledDefaultWaitMonths: p.settledDefaultWaitMonths ?? null,
  verified: !!p.verified,
});

function Summary({ product }: { product: Product }) {
  return (
    <>
      <span className="product-name">
        <b>{FINANCE_TYPE[product.financeType]}</b>
        <small>{product.name}</small>
      </span>
      <span className="product-terms">
        <span>
          هامش {percent(product.rate)} {RATE_TYPE[product.rateType]}
        </span>
        <span>
          حتى <Num value={product.maxAmount} />
        </span>
        <span>{months(product.maxTenor)}</span>
        <span data-open={product.settledDefaultWaitMonths == null || undefined}>{afterDefaultText(product.settledDefaultWaitMonths)}</span>
      </span>
      <span className="route-state" data-status={product.verified ? "pass" : "warn"}>
        {product.verified ? "مؤكدة" : "استرشادية"}
      </span>
    </>
  );
}

export default async function LendersPage() {
  const me = await requireActor();
  const mayManage = can(me.role, "lender.manage");
  const catalogue = await listCatalogue(await getDb());
  const all = catalogue.flatMap((lender) => lender.products);
  const confirmed = all.filter((p) => p.verified).length;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الجهات</h1>
        </div>
        <div className="head-side">
          <p className="where">
            {counted(catalogue.length, LENDERS)} · {counted(all.length, PRODUCTS)} · <b>{confirmed ? `المؤكد منها ${confirmed}` : "لم تؤكَّد شروطها بعد"}</b>
          </p>
        </div>
      </div>
      <LendersNav current="/lenders" />

      {!catalogue.length ? (
        <section className="empty">
          <h2>لا جهات في القائمة</h2>
          <p>تُضاف الجهات وشروطها هنا، وتُحسب عليها كل صفقة.</p>
        </section>
      ) : (
        <div className="bento">
          {confirmed < all.length && (
            <section className="tile tile--wide tile--notes">
              <p className="note" data-level="warn">
                الشروط غير المؤكدة مأخوذة من مصادر عامة. صحّح ما تعرفه من تعاملك مع كل جهة، وعلّم عليه أنه مؤكد.
              </p>
            </section>
          )}
          {catalogue.map((lender) => (
            <section key={lender.id} className="tile tile--lender">
              <h2 className="lender-name">
                {lender.name}
                <small>{LENDER_TYPE[lender.type]}</small>
              </h2>
              {lender.products.map((product) =>
                mayManage ? (
                  <details key={product.id} className="product">
                    <summary>
                      <Summary product={product} />
                      <ChevronIcon />
                    </summary>
                    <ProductForm productId={Number(product.id)} mortgage={product.financeType === "mortgage"} initial={termsOf(product)} />
                  </details>
                ) : (
                  <div key={product.id} className="product">
                    <div className="product-row">
                      <Summary product={product} />
                    </div>
                  </div>
                ),
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
