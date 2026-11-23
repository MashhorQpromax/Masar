"use client";

import { useState, useTransition } from "react";
import { SECTOR } from "@/copy/editor";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { lenderError, NATIONALITY_CHOICE, PRODUCT_NAME, RATE_TYPE } from "@/copy/lenders";
import { PRODUCT_KINDS, SECTORS, type Nationality, type ProductKind, type Sector } from "@/domain/eligibility";
import type { RateType } from "@/domain/finance";
import type { ProductScope, ProductTerms } from "@/server/lenders/input";
import { Check, NumberField, Segmented, TextField } from "@/ui/fields";
import { CheckIcon } from "@/ui/icons";
import { saveProduct, saveProductTerms, type TermsAnswer } from "./actions";

type AfterDefault = "unknown" | "now" | "wait";
const AFTER_DEFAULT: Record<AfterDefault, string> = { unknown: "لم نؤكد", now: "تقبل فوراً", wait: "تنتظر مدة" };
const KIND = Object.fromEntries(PRODUCT_KINDS.map((kind) => [kind, FINANCE_TYPE[kind]])) as Record<ProductKind, string>;
const NATIONALITIES: Nationality[] = ["saudi", "non_saudi"];
/** Who a new product is taken to serve until someone says otherwise: people on a salary. */
const SALARIED: Sector[] = ["gov", "semi_gov", "military", "private_approved", "retired"];
/** The longest term a new product starts with, by its kind. */
const tenorOf = (kind: ProductKind): number => (kind === "mortgage" ? 300 : 60);

/** What a new product starts with. The margin and the largest amount are left for the person to write. */
const fresh = (bank: boolean): { terms: ProductTerms; scope: ProductScope } => ({
  terms: {
    rate: Number.NaN,
    rateType: "flat",
    maxAmount: Number.NaN,
    maxTenor: tenorOf("personal"),
    maxAgeAtMaturity: 65,
    minSalary: 4000,
    minServiceMonths: 3,
    maxLtv: null,
    requiresSalaryTransfer: bank,
    acceptsLateSimah: false,
    settledDefaultWaitMonths: null,
    verified: false,
  },
  scope: { name: PRODUCT_NAME.personal, sectors: SALARIED, nationalities: ["saudi"], minAge: 21 },
});

type Existing = { productId: number; kind: string; initial: ProductTerms; scope: ProductScope };
type Fresh = { lenderId: number; bank: boolean };

/**
 * One product of a lender: what it is called, who it is given to and its terms. The same form corrects
 * a product after asking the lender, and adds a new one.
 */
export function ProductForm(props: Existing | Fresh) {
  const adding = "lenderId" in props;
  const start = adding ? fresh(props.bank) : { terms: props.initial, scope: props.scope };
  const [kind, setKind] = useState<ProductKind>("personal");
  const [terms, setTerms] = useState(start.terms);
  const [scope, setScope] = useState(start.scope);
  const [after, setAfter] = useState<AfterDefault>(start.terms.settledDefaultWaitMonths == null ? "unknown" : start.terms.settledDefaultWaitMonths === 0 ? "now" : "wait");
  const [answer, setAnswer] = useState<TermsAnswer>({});
  const [busy, run] = useTransition();
  const mortgage = adding ? kind === "mortgage" : props.kind === "mortgage";
  const set = (patch: Partial<ProductTerms>) => {
    setTerms((current) => ({ ...current, ...patch }));
    setAnswer({});
  };
  const within = (patch: Partial<ProductScope>) => {
    setScope((current) => ({ ...current, ...patch }));
    setAnswer({});
  };
  // An emptied number keeps the form from saving until it is filled again.
  const num = (key: "rate" | "maxAmount" | "maxTenor" | "maxAgeAtMaturity" | "minSalary" | "minServiceMonths") => (value: number | null) => set({ [key]: value ?? Number.NaN });
  const shown = (value: number) => (Number.isNaN(value) ? null : value);
  const wait = after === "unknown" ? null : after === "now" ? 0 : terms.settledDefaultWaitMonths || null;
  const complete =
    Object.values(terms).every((value) => typeof value !== "number" || !Number.isNaN(value)) &&
    (after !== "wait" || !!wait) &&
    scope.name.trim().length >= 2 &&
    scope.sectors.length > 0 &&
    scope.nationalities.length > 0 &&
    !Number.isNaN(scope.minAge);

  /** A new product takes the usual name and term of its kind, unless the person already wrote their own. */
  function choose(next: ProductKind) {
    setScope((current) => ({ ...current, name: current.name === PRODUCT_NAME[kind] || !current.name.trim() ? PRODUCT_NAME[next] : current.name }));
    setTerms((current) => ({ ...current, maxTenor: current.maxTenor === tenorOf(kind) ? tenorOf(next) : current.maxTenor, maxLtv: next === "mortgage" ? current.maxLtv : null }));
    setKind(next);
    setAnswer({});
  }

  function save() {
    const sent = { ...terms, settledDefaultWaitMonths: wait };
    run(async () => {
      const result = adding ? await saveProduct(props.lenderId, { financeType: kind, scope, terms: sent }) : await saveProductTerms(props.productId, sent, scope);
      setAnswer(result);
      if (adding && result.saved) {
        // The product is in the list above now. The form goes back to empty for the next one.
        const again = fresh(props.bank);
        setKind("personal");
        setTerms(again.terms);
        setScope(again.scope);
        setAfter("unknown");
      }
    });
  }

  return (
    <form
      className="terms"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {adding && (
        <div className="field">
          <span className="field-label">نوع التمويل</span>
          <Segmented label="نوع التمويل" value={kind} onChange={choose} options={KIND} />
        </div>
      )}
      <div className="terms-who">
        <TextField label="اسم المنتج" value={scope.name} onChange={(name) => within({ name })} maxLength={80} />
        <fieldset className="terms-chips">
          <legend className="field-label">لمن يُعطى</legend>
          {SECTORS.map((sector) => (
            <label key={sector} className="ask-chip">
              <input type="checkbox" checked={scope.sectors.includes(sector)} onChange={(event) => within({ sectors: SECTORS.filter((each) => (each === sector ? event.target.checked : scope.sectors.includes(each))) })} />
              <span>{SECTOR[sector]}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="terms-chips">
          <legend className="field-label">الجنسية</legend>
          {NATIONALITIES.map((nationality) => (
            <label key={nationality} className="ask-chip">
              <input
                type="checkbox"
                checked={scope.nationalities.includes(nationality)}
                onChange={(event) => within({ nationalities: NATIONALITIES.filter((each) => (each === nationality ? event.target.checked : scope.nationalities.includes(each))) })}
              />
              <span>{NATIONALITY_CHOICE[nationality]}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="fields">
        <NumberField label="الهامش السنوي" suffix="%" decimals={2} max={30} placeholder={adding ? "3.5" : undefined} value={shown(terms.rate)} onChange={num("rate")} />
        <div className="field">
          <span className="field-label">نوع الهامش</span>
          <Segmented label="نوع الهامش" value={terms.rateType as RateType} onChange={(rateType) => set({ rateType })} options={RATE_TYPE} />
        </div>
        <NumberField label="أقصى مبلغ" money max={10_000_000_000} placeholder={adding ? "500,000" : undefined} value={shown(terms.maxAmount)} onChange={num("maxAmount")} />
        <NumberField label="أقصى مدة" suffix="شهراً" max={420} value={shown(terms.maxTenor)} onChange={num("maxTenor")} />
        <NumberField label="أدنى عمر" suffix="سنة" grouped={false} max={70} value={shown(scope.minAge)} onChange={(minAge) => within({ minAge: minAge ?? Number.NaN })} />
        <NumberField label="أقصى عمر عند آخر قسط" suffix="سنة" grouped={false} max={90} value={shown(terms.maxAgeAtMaturity)} onChange={num("maxAgeAtMaturity")} />
        <NumberField label="أدنى راتب" money max={10_000_000} value={shown(terms.minSalary)} onChange={num("minSalary")} />
        <NumberField label="أدنى مدة خدمة" suffix="شهراً" max={720} value={shown(terms.minServiceMonths)} onChange={num("minServiceMonths")} />
        {mortgage && <NumberField label="نسبة التمويل من قيمة العقار" suffix="%" decimals={1} max={100} value={terms.maxLtv} onChange={(maxLtv) => set({ maxLtv })} />}
      </div>
      <div className="terms-asks">
        <Check label="تشترط تحويل الراتب" checked={terms.requiresSalaryTransfer} onChange={(requiresSalaryTransfer) => set({ requiresSalaryTransfer })} />
        <Check label="تقبل تأخر السداد في سمة" checked={terms.acceptsLateSimah} onChange={(acceptsLateSimah) => set({ acceptsLateSimah })} />
      </div>
      <div className="terms-after">
        <div className="field">
          <span className="field-label">من سدّد تعثره</span>
          <Segmented
            label="من سدّد تعثره"
            value={after}
            onChange={(next) => {
              setAfter(next);
              setAnswer({});
            }}
            options={AFTER_DEFAULT}
          />
        </div>
        {after === "wait" && (
          <NumberField label="مدة الانتظار بعد السداد" suffix="شهراً" max={120} value={terms.settledDefaultWaitMonths || null} onChange={(settledDefaultWaitMonths) => set({ settledDefaultWaitMonths })} />
        )}
      </div>
      <div className="terms-save">
        <Check label="أكّدنا هذه الشروط مع الجهة" checked={terms.verified} onChange={(verified) => set({ verified })} />
        <button type="submit" className="btn btn--navy" disabled={busy || !complete} aria-busy={busy}>
          {adding ? "أضف المنتج" : "احفظ"}
        </button>
        {answer.error ? (
          <p key={answer.error} role="alert" className="said" data-bad>
            {lenderError(answer.error, answer.params)}
          </p>
        ) : (
          answer.saved &&
          !busy && (
            <p role="status" className="said">
              <CheckIcon size={16} />
              {adding ? "أُضيف المنتج" : "حُفظ المنتج"}
            </p>
          )
        )}
      </div>
    </form>
  );
}
