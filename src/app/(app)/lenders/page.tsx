import type { Metadata } from "next";
import { conditionText, FINANCE_TYPE, SPECIAL_CONDITIONS, SPECIAL_KIND, UNMET } from "@/copy/eligibility";
import { counted, dayOfIso, months, percent } from "@/copy/format";
import { afterDefaultText, confirmedText, LENDER_TYPE, LENDERS, PRODUCTS, RATE_TYPE, SOURCE_KIND, TERM_NAME, VALIDITY_SAY } from "@/copy/lenders";
import { can } from "@/domain/auth";
import { dayOf, openTerms, sourceGroups, termsOf, type Product, type TermSource } from "@/domain/eligibility";
import { requireActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { listCatalogue } from "@/server/lenders/service";
import { ChevronIcon, PlusIcon } from "@/ui/icons";
import { Num } from "@/ui/Num";
import { SubmitButton } from "@/ui/SubmitButton";
import { dropCondition, switchProduct, withdrawProductTerms } from "./actions";
import { ConditionForm } from "./ConditionForm";
import { ConfirmForm } from "./ConfirmForm";
import { LenderForm } from "./LenderForm";
import { LendersNav } from "./LendersNav";
import { ProductForm } from "./ProductForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "الجهات · مسار" };

const valuesOf = (p: Product) => ({
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
});

const scopeOf = (p: Product) => ({ name: p.name, sectors: p.sectors, nationalities: p.nationalities, minAge: p.minAge });

function Summary({ product }: { product: Product }) {
  const terms = termsOf(product.financeType);
  const open = openTerms(product.financeType, product.terms);
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
        {!!product.special?.length && <span>{counted(product.special.length, SPECIAL_CONDITIONS)}</span>}
      </span>
      <span className="route-state" data-status={product.verified ? "pass" : "warn"}>
        {confirmedText(terms.length - open.length, terms.length)}
      </span>
    </>
  );
}

/** What names a source. A page of the lender's site opens; anything else is read as written. */
function Reference({ source }: { source: TermSource }) {
  if (source.kind === "lender_website" && /^https?:\/\//i.test(source.reference) && URL.canParse(source.reference)) {
    return (
      <a className="source-ref note-link" href={source.reference} target="_blank" rel="noreferrer noopener" dir="ltr">
        {new URL(source.reference).host}
      </a>
    );
  }
  return <span className="source-ref">{source.reference}</span>;
}

/**
 * Where a product's terms come from: each source with the terms it speaks for and the day it stops
 * being good, the terms nobody confirmed, and the form that confirms them for whoever may.
 */
function Sources({ product, mayConfirm, today }: { product: Product; mayConfirm: boolean; today: string }) {
  const terms = termsOf(product.financeType);
  const open = openTerms(product.financeType, product.terms);
  const groups = sourceGroups(product.financeType, product.terms);
  const bare = terms.filter((term) => (product.terms?.[term]?.state ?? "unconfirmed") === "unconfirmed");
  return (
    <section className="sources">
      <h3 className="sources-title">مصادر الشروط</h3>
      {groups.length > 0 && (
        <ul className="source-list">
          {groups.map((group) => (
            <li key={group.terms[0]} className="source" data-state={group.state}>
              <div className="source-text">
                <span className="source-what">
                  <b>{SOURCE_KIND[group.source.kind]}</b>
                  <Reference source={group.source} />
                </span>
                <span className="source-terms">{group.terms.map((term) => TERM_NAME[term]).join("، ")}</span>
                <small>{group.state === "confirmed" ? `يصلح حتى ${dayOfIso(group.validUntil)}` : `انتهى في ${dayOfIso(group.validUntil)}. اسأل الجهة من جديد.`}</small>
              </div>
              {mayConfirm && (
                <details className="know-remove">
                  <summary aria-label={`اسحب تأكيد: ${group.terms.map((term) => TERM_NAME[term]).join("، ")}`}>اسحب</summary>
                  <form action={withdrawProductTerms}>
                    <input type="hidden" name="productId" value={product.id} />
                    {group.terms.map((term) => (
                      <input key={term} type="hidden" name="term" value={term} />
                    ))}
                    <SubmitButton className="btn btn--soft">نعم، اسحب التأكيد</SubmitButton>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {bare.length > 0 && (
        <p className="sources-bare">
          <b>بلا مصدر</b>
          {bare.map((term) => TERM_NAME[term]).join("، ")}
        </p>
      )}
      {mayConfirm ? <ConfirmForm productId={Number(product.id)} terms={terms} open={open} today={today} /> : open.length > 0 && <p className="sources-say">يؤكدها المدير، كل شرط بمصدره.</p>}
    </section>
  );
}

/**
 * What this lender asks beyond the terms every product has. Whoever keeps the catalogue writes each
 * condition down as the office learns it, and takes off one that turned out wrong. Writing confirms
 * nothing: the list as a whole is the term «الشروط الخاصة», confirmed with the others.
 */
function Special({ product, mayManage }: { product: Product; mayManage: boolean }) {
  const list = product.special ?? [];
  return (
    <section className="sources">
      <h3 className="sources-title">الشروط الخاصة</h3>
      {list.length > 0 ? (
        <ul className="source-list">
          {list.map((condition) => (
            <li key={condition.id} className="source">
              <div className="source-text">
                <span className="source-what">
                  <b>{SPECIAL_KIND[condition.kind]}</b>
                  {/* A condition a person answers is named by its kind already: beside it go only the lender's own words. */}
                  {"unmet" in condition ? condition.text && <span className="source-ref">{condition.text}</span> : <span className="source-ref">{conditionText(condition)}</span>}
                </span>
                <small>{"unmet" in condition ? `${UNMET[condition.unmet]}. يُجاب عنه لكل عميل، وما لم يُجب عنه لا يُحسب مستوفى.` : "يقيسه النظام من الملف والسجل."}</small>
              </div>
              {mayManage && (
                <details className="know-remove">
                  <summary aria-label={`احذف الشرط: ${conditionText(condition)}`}>احذف</summary>
                  <form action={dropCondition}>
                    <input type="hidden" name="conditionId" value={condition.id} />
                    <SubmitButton className="btn btn--soft">نعم، احذف الشرط</SubmitButton>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sources-say">لا شرط خاصاً مسجلاً. خلوّ القائمة لا يعني أن الجهة لا تشترط شيئاً حتى يؤكَّد ذلك بمصدر.</p>
      )}
      {mayManage && <ConditionForm productId={Number(product.id)} />}
    </section>
  );
}

export default async function LendersPage() {
  const me = await requireActor();
  const mayManage = can(me.role, "lender.manage");
  const mayConfirm = can(me.role, "lender.confirm");
  const today = dayOf(new Date());
  // Whoever keeps the catalogue also sees what was stopped, and a lender that has no product yet.
  const catalogue = await listCatalogue(await getDb(), { stopped: mayManage });
  const all = catalogue.flatMap((lender) => lender.products).filter((p) => p.active);
  const inUse = catalogue.filter((lender) => lender.products.some((p) => p.active)).length;
  const confirmed = all.filter((p) => p.verified).length;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">الجهات</h1>
        </div>
        <div className="head-side">
          <p className="where">
            {counted(inUse, LENDERS)} · {counted(all.length, PRODUCTS)} · <b>{confirmed ? `المؤكد منها ${confirmed}` : "لم تؤكَّد شروطها بعد"}</b>
          </p>
        </div>
      </div>
      <LendersNav current="/lenders" />

      {!catalogue.length && !mayManage ? (
        <section className="empty">
          <h2>لا جهات في القائمة</h2>
          <p>تُضاف الجهات وشروطها هنا، وتُحسب عليها كل صفقة.</p>
        </section>
      ) : (
        <div className="bento">
          {confirmed < all.length && (
            <section className="tile tile--wide tile--notes">
              <p className="note" data-level="warn">
                الشرط غير المؤكد مأخوذ من مصادر عامة، ولا تُبنى عليه نتيجة لعميل. يُؤكَّد كل شرط بمصدره من الجهة نفسها: مستند منها، أو صفحة من موقعها، أو إفادة موظف فيها. {VALIDITY_SAY}
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
                !product.active ? (
                  <div key={product.id} className="product" data-stopped>
                    <div className="product-row">
                      <span className="product-name">
                        <b>{FINANCE_TYPE[product.financeType]}</b>
                        <small>{product.name}</small>
                      </span>
                      <span className="product-terms">
                        <span>متوقف. لا يُعرض على عميل ولا تُحسب عليه صفقة.</span>
                      </span>
                      <form action={switchProduct}>
                        <input type="hidden" name="productId" value={product.id} />
                        <input type="hidden" name="active" value="1" />
                        <SubmitButton className="btn btn--soft">أعده</SubmitButton>
                      </form>
                    </div>
                  </div>
                ) : mayManage ? (
                  <details key={product.id} className="product">
                    <summary>
                      <Summary product={product} />
                      <ChevronIcon />
                    </summary>
                    <ProductForm productId={Number(product.id)} kind={product.financeType} initial={valuesOf(product)} scope={scopeOf(product)} />
                    <Special product={product} mayManage={mayManage} />
                    <Sources product={product} mayConfirm={mayConfirm} today={today} />
                    <details className="know-remove product-stop">
                      <summary aria-label={`أوقف: ${product.name}`}>أوقف هذا المنتج</summary>
                      <form action={switchProduct}>
                        <input type="hidden" name="productId" value={product.id} />
                        <input type="hidden" name="active" value="0" />
                        <SubmitButton className="btn btn--soft">نعم، أوقفه</SubmitButton>
                      </form>
                    </details>
                  </details>
                ) : (
                  <div key={product.id} className="product">
                    <div className="product-row">
                      <Summary product={product} />
                    </div>
                    {!!product.special?.length && <Special product={product} mayManage={false} />}
                  </div>
                ),
              )}
              {mayManage && (
                <details className="product product--new" open={lender.products.length === 0}>
                  <summary>
                    <span className="product-add">
                      <PlusIcon size={16} />
                      {lender.products.length ? "منتج جديد" : "أضف منتجها الأول"}
                    </span>
                    <ChevronIcon />
                  </summary>
                  <ProductForm lenderId={lender.id} bank={lender.type === "bank"} />
                </details>
              )}
            </section>
          ))}
          {mayManage && (
            <section className="tile tile--lender tile--newlender">
              <h2 className="lender-name">جهة جديدة</h2>
              <p className="lender-new-say">جهة بدأ المكتب يتعامل معها. تُضاف باسمها، ثم يُكتب منتجها الأول وشروطه.</p>
              <LenderForm />
            </section>
          )}
        </div>
      )}
    </>
  );
}
