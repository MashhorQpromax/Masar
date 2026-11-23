"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FEE_REASON, riskText, STRUCTURE, VERDICT } from "@/copy/deal";
import { DRAFT_GAP, FINANCE_BASE, ITEM_KIND, LENDER_KIND, notInDeal, PAID_BY, PAYOFF_ESTIMATED, REPORT_FILLED, reportDay, saveError, SECTOR } from "@/copy/editor";
import { CONTRACT_TYPE } from "@/copy/eligibility";
import { ltr, percent, plainMoney } from "@/copy/format";
import {
  borrowerIn,
  dealStudy,
  DEFAULT_PAYER,
  FEE_MAX,
  FEE_MIN,
  joinLabel,
  labelParts,
  pendingDrafts,
  STRUCTURES,
  structureOf,
  type CreditFlags,
  type DealInput,
  type DealItem,
  type DraftGap,
  type ItemKind,
  type LenderKind,
  type PaidBy,
  type ReportDraft,
  type Sector,
} from "@/domain/deal";
import type { ContractType } from "@/domain/eligibility";
import { gregorianBirthYear } from "@/domain/shared/calendar";
import { Check, NumberField, Segmented, SelectField, TextField } from "@/ui/fields";
import { ChevronIcon, CloseIcon, PlusIcon } from "@/ui/icons";
import { saveDealForm } from "./actions";

export interface BorrowerDraft {
  fullName: string;
  birthYear: number | null;
  sector: Sector;
  basicSalary: number | null;
  totalSalary: number | null;
  serviceMonths: number | null;
  /** How the client is employed. Null until someone says. */
  contractType: ContractType | null;
}

/** The kinds of contract, with the choice of saying none. */
const CONTRACT_CHOICE: Record<ContractType | "", string> = { "": "غير مدخل", ...CONTRACT_TYPE };

/** A commitment the client's credit report shows, worded and ready to be put in the deal. */
export type OfferedDraft = ReportDraft & { label: string };

/** What the client's stored credit report offers a deal. */
export interface ReportOffer {
  /** The day the report was issued, as SIMAH prints it. */
  day: string | null;
  drafts: OfferedDraft[];
}

/** An obligation while it is being typed. An empty amount after discount means no discount. */
interface Row {
  id: string;
  kind: ItemKind;
  title: string;
  party: string;
  original: number | null;
  pay: number | null;
  by: PaidBy;
  confirmed: boolean;
  monthly: number | null;
  /** On an item that came from the credit report: what the report did not give. */
  missing?: DraftGap[];
  /** On a loan that came from the report: the payoff we estimated, until a person writes another. */
  estimate?: number | null;
}

const KINDS = Object.keys(ITEM_KIND) as ItemKind[];
const PAYOFF = new Set<ItemKind>(["mortgage_payoff", "personal_payoff"]);
const NO_LENDER_KIND = { "": "غير محدد", ...LENDER_KIND };
const NO_DRAFTS: OfferedDraft[] = [];

const toRow = (item: DealItem): Row => ({
  id: item.id,
  kind: item.kind,
  ...labelParts(item.label),
  original: item.original,
  pay: item.pay === item.original ? null : item.pay,
  by: item.by,
  confirmed: !!item.confirmed,
  monthly: item.monthly ?? null,
});

/** An item from the credit report as a row a person reviews. Nothing is kept until the deal is saved. */
const draftRow = (draft: OfferedDraft, id: string): Row => {
  const estimated = PAYOFF.has(draft.kind) && draft.pay !== draft.original;
  return {
    id,
    kind: draft.kind,
    ...labelParts(draft.label),
    original: draft.original || null,
    pay: draft.pay === draft.original ? null : draft.pay,
    by: draft.by,
    confirmed: false,
    monthly: draft.monthly ?? null,
    missing: draft.missing,
    estimate: estimated ? draft.pay : null,
  };
};

const toItem = (row: Row): DealItem => {
  const original = row.original ?? 0;
  return {
    id: row.id,
    kind: row.kind,
    label: joinLabel(row.title.trim() || ITEM_KIND[row.kind], row.party),
    original,
    pay: row.pay ?? original,
    by: row.by,
    ...(PAYOFF.has(row.kind) ? { confirmed: row.confirmed } : {}),
    monthly: row.monthly,
  };
};

export function DealEditor({
  dealId,
  clientId = null,
  phone: knownPhone = "",
  year,
  borrower,
  input,
  credit = null,
  fromReport = null,
}: {
  /** The deal being revised, or null for a new deal. */
  dealId: number | null;
  /** The client a new deal is for, when they already have a file. Null opens a new file. */
  clientId?: number | null;
  /** The mobile a new file starts with, when the person wrote to the office before having one. */
  phone?: string;
  /** The current year, from the server, so both sides compute the same age. */
  year: number;
  borrower: BorrowerDraft;
  input: DealInput;
  /** What the client's credit record adds to the notes. Null for a client with no report read. */
  credit?: CreditFlags | null;
  /** What the client's credit report says the deal has to deal with. Null with no report, or for someone who may not read it. */
  fromReport?: ReportOffer | null;
}) {
  const [who, setWho] = useState(borrower);
  const [born, setBorn] = useState(borrower.birthYear);
  const [phone, setPhone] = useState(knownPhone);
  const opensFile = dealId == null && clientId == null;
  const [x, setX] = useState<DealInput>(() => ({ ...input, items: [] }));
  const offered = fromReport?.drafts ?? NO_DRAFTS;
  // A new deal starts from what the report shows, for the person to review. A deal that has items is the person's own list.
  const filled = dealId == null && input.items.length === 0 && offered.length > 0;
  const [rows, setRows] = useState<Row[]>(() => (filled ? offered.map((draft, index) => draftRow(draft, `i${index + 1}`)) : input.items.map(toRow)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const added = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const birthYear = born == null ? null : gregorianBirthYear(born);
  const facts = useMemo(() => ({ ...who, birthYear }), [who, birthYear]);
  const full = useMemo<DealInput>(() => ({ ...x, items: rows.map(toItem) }), [x, rows]);
  /** What the report shows and the deal does not hold yet. */
  const unplaced = useMemo(() => pendingDrafts(offered, full.items), [offered, full.items]);
  const study = useMemo(() => dealStudy(full, borrowerIn(facts, year), credit), [full, facts, year, credit]);
  /** What the engine estimates from the salary, shown beside a bank offer. */
  const estimate = useMemo(
    () =>
      full.bankMortgage == null && full.bankPersonal == null
        ? study.financing
        : dealStudy({ ...full, bankMortgage: null, bankPersonal: null }, borrowerIn(facts, year)).financing,
    [full, facts, year, study],
  );

  const structure = structureOf(x);
  const st = STRUCTURES[structure];
  const ready = rows.length > 0;
  const closes = study.verdict === "go" || study.verdict === "tight";
  const notes = study.risks.filter((risk) => risk.level !== "info").slice(0, 2);
  const age = birthYear != null ? year - birthYear : null;

  const set = (patch: Partial<DealInput>) => setX((prev) => ({ ...prev, ...patch }));
  const setFee = (patch: Partial<DealInput["fee"]>) => setX((prev) => ({ ...prev, fee: { ...prev.fee, ...patch } }));
  const setRow = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  function addRow(kind: ItemKind) {
    setRows((prev) => {
      let n = prev.length + 1;
      while (prev.some((row) => row.id === `i${n}`)) n++;
      added.current = `i${n}`;
      return [...prev, { id: `i${n}`, kind, title: ITEM_KIND[kind], party: "", original: null, pay: null, by: DEFAULT_PAYER[kind], confirmed: false, monthly: null }];
    });
  }

  function addDrafts(drafts: OfferedDraft[]) {
    setRows((prev) => {
      const next = [...prev];
      for (const draft of drafts) {
        let n = next.length + 1;
        while (next.some((row) => row.id === `i${n}`)) n++;
        next.push(draftRow(draft, `i${n}`));
        added.current ??= `i${n}`;
      }
      return next;
    });
  }

  // A new obligation opens ready to be typed into.
  useEffect(() => {
    if (!added.current) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-row="${added.current}"]`);
    row?.querySelector<HTMLInputElement>("[data-first] input")?.focus();
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    added.current = null;
  }, [rows.length]);

  const problem = !who.fullName.trim()
    ? "اكتب اسم العميل."
    : birthYear != null && (birthYear < 1930 || birthYear > year - 18)
      ? "سنة الميلاد غير صحيحة."
      : who.basicSalary != null && who.totalSalary != null && who.basicSalary > who.totalSalary
        ? "الراتب الأساسي أعلى من الإجمالي."
        : rows.length === 0
          ? "أضف التزاماً واحداً على الأقل."
          : rows.some((row) => !row.original)
            ? "اكتب مبلغ كل التزام."
            : null;

  function save() {
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveDealForm({ dealId, clientId, phone: opensFile ? phone.trim() || null : null, borrower: { ...facts, fullName: who.fullName.trim() }, input: full });
      if (result?.error) setError(saveError(result.error, result.params));
    });
  }

  /** The figure that answers the deal: what the client keeps, or how much is missing. Long ones are set smaller. */
  const amount = closes ? plainMoney(study.clientNet) : study.verdict === "short" ? plainMoney(-study.clientNet) : null;
  const figure = amount && (
    <p className="result-keep">
      <span>{closes ? "يبقى للعميل" : "العجز"}</span>
      <b key={amount} className="num tick" data-size={amount.length > 9 ? "s" : amount.length > 7 ? "m" : undefined}>
        {amount}
      </b>
    </p>
  );

  const saveLabel = dealId == null ? "احفظ الصفقة" : "احفظ التعديل";

  return (
    <form
      className="editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="editor-main">
        <section className="tile form-tile">
          <h2 className="form-title">
            <i>1</i>العميل
          </h2>
          <div className="fields fields--who">
            <TextField label="الاسم" value={who.fullName} onChange={(fullName) => setWho({ ...who, fullName })} autoFocus={dealId == null} />
            <SelectField label="جهة العمل" value={who.sector} onChange={(sector) => setWho({ ...who, sector })} options={SECTOR} />
            {who.sector !== "retired" && who.sector !== "self" && (
              <SelectField label="نوع العقد" value={who.contractType ?? ""} onChange={(contractType) => setWho({ ...who, contractType: contractType || null })} options={CONTRACT_CHOICE} />
            )}
            <NumberField
              label="سنة الميلاد"
              value={born}
              onChange={setBorn}
              grouped={false}
              max={2100}
              placeholder="ميلادي أو هجري"
              hint={
                age != null && age >= 18 && age < 100
                  ? born !== birthYear
                    ? `يوافق ${ltr(birthYear!)} ميلادي، العمر ${ltr(age)}`
                    : `العمر ${ltr(age)}`
                  : undefined
              }
            />
            <NumberField
              label="سنوات الخدمة"
              suffix="سنة"
              value={who.serviceMonths == null ? null : Math.round((who.serviceMonths / 12) * 100) / 100}
              onChange={(years) => setWho({ ...who, serviceMonths: years == null ? null : Math.round(years * 12) })}
              decimals={2}
              max={60}
            />
            <NumberField label="الراتب الأساسي" money value={who.basicSalary} onChange={(basicSalary) => setWho({ ...who, basicSalary })} max={10_000_000} />
            <NumberField label="الراتب الإجمالي" money value={who.totalSalary} onChange={(totalSalary) => setWho({ ...who, totalSalary })} max={10_000_000} />
          </div>
          {opensFile && (
            <div className="fields fields--reach">
              <TextField label="الجوال" typed="tel" value={phone} onChange={setPhone} placeholder="05xxxxxxxx" maxLength={20} hint="اختياري. عليه تصله رسائل ملفه في واتساب." />
            </div>
          )}
        </section>

        <section className="tile form-tile">
          <h2 className="form-title">
            <i>2</i>ما يُسدَّد عنه
          </h2>
          {fromReport && unplaced.length > 0 && (
            <div className="offer" id="from-report">
              <div className="offer-head">
                <p>
                  <b>{reportDay(fromReport.day)}</b>
                  <span>{notInDeal(unplaced.length)}</span>
                </p>
                {unplaced.length > 1 && (
                  <button type="button" className="add-chip" onClick={() => addDrafts(unplaced)}>
                    <PlusIcon size={16} />
                    أضف الكل
                  </button>
                )}
              </div>
              <ul className="offer-list">
                {unplaced.map((draft, index) => {
                  const { title, party } = labelParts(draft.label);
                  return (
                    <li key={`${draft.label}-${index}`}>
                      <span className="offer-what">
                        <b>{title}</b>
                        {party && <small>{party}</small>}
                      </span>
                      <span className="offer-sum num">{draft.original ? plainMoney(draft.original) : "-"}</span>
                      <button type="button" className="add-chip" aria-label={`أضف ${title}${party ? `، ${party}` : ""}`} onClick={() => addDrafts([draft])}>
                        أضف
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {fromReport && filled && unplaced.length === 0 && (
            <p className="offer-done" id="from-report">
              <b>{reportDay(fromReport.day)}</b>
              {REPORT_FILLED}
            </p>
          )}
          <div ref={list} className="items">
            {rows.map((row) => {
              const discount = row.original && row.pay != null && row.pay < row.original ? (1 - row.pay / row.original) * 100 : null;
              return (
                <div key={row.id} className="item" data-row={row.id} data-out={row.by === "out" || undefined}>
                  <div className="item-head">
                    <input
                      className="item-title"
                      aria-label="وصف الالتزام"
                      maxLength={80}
                      placeholder={ITEM_KIND[row.kind]}
                      value={row.title}
                      onChange={(event) => setRow(row.id, { title: event.target.value })}
                    />
                    <button
                      type="button"
                      className="item-remove"
                      aria-label={`احذف ${row.title || ITEM_KIND[row.kind]}`}
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  <div className="fields">
                    <div data-first className="contents">
                      <TextField label="الجهة" value={row.party} onChange={(party) => setRow(row.id, { party })} maxLength={80} placeholder="البنك أو الشركة" />
                    </div>
                    <NumberField
                      label="المبلغ المسجل"
                      money
                      value={row.original}
                      onChange={(original) => setRow(row.id, { original })}
                      max={10_000_000_000}
                      hint={!row.original && row.missing?.includes("amount") ? DRAFT_GAP.amount : undefined}
                    />
                    <NumberField
                      label="بعد الخصم"
                      money
                      value={row.pay}
                      onChange={(pay) => setRow(row.id, { pay })}
                      max={10_000_000_000}
                      placeholder={row.original ? plainMoney(row.original) : undefined}
                      hint={row.estimate != null && row.pay === row.estimate ? PAYOFF_ESTIMATED : discount != null ? `خصم ${percent(Math.round(discount * 10) / 10)}` : "فارغ يعني بلا خصم"}
                    />
                    {(row.by === "out" || (row.kind !== "execution" && row.kind !== "default")) && (
                      <NumberField
                        label="القسط الشهري"
                        money
                        value={row.monthly}
                        onChange={(monthly) => setRow(row.id, { monthly })}
                        max={10_000_000}
                        hint={!row.monthly && row.missing?.includes("monthly") ? DRAFT_GAP.monthly : undefined}
                      />
                    )}
                  </div>
                  <div className="item-foot">
                    <Segmented label="من يسدده" value={row.by} onChange={(by) => setRow(row.id, { by })} options={PAID_BY} />
                    {PAYOFF.has(row.kind) && <Check label="مؤكد بخطاب مخالصة" checked={row.confirmed} onChange={(confirmed) => setRow(row.id, { confirmed })} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="add-row">
            {KINDS.map((kind) => (
              <button key={kind} type="button" className="add-chip" onClick={() => addRow(kind)}>
                <PlusIcon size={16} />
                {ITEM_KIND[kind]}
              </button>
            ))}
          </div>
        </section>

        <section className="tile form-tile">
          <h2 className="form-title">
            <i>3</i>التمويل الجديد
          </h2>
          <Segmented label="هيكل الصفقة" value={structure} onChange={(next) => set({ structure: next })} options={STRUCTURE} />
          <div className="fields">
            {st.mortgage && (
              <NumberField label="قيمة العقار" money value={x.propertyValue} onChange={(propertyValue) => set({ propertyValue })} max={10_000_000_000} hint="سعر البيع المتوقع للبنك" />
            )}
            <TextField label="البنك المستهدف" value={x.targetBank ?? ""} onChange={(bank) => set({ targetBank: bank || null, mortgageCeiling: null })} maxLength={60} />
            {st.mortgage && (
              <NumberField
                label="عرض البنك للعقاري"
                money
                value={x.bankMortgage}
                onChange={(bankMortgage) => set({ bankMortgage })}
                max={10_000_000_000}
                placeholder={estimate.mortgage ? plainMoney(estimate.mortgage) : undefined}
                hint="فارغ يعني تقديرنا من الراتب"
              />
            )}
            {st.personal && (
              <NumberField
                label="عرض البنك للشخصي"
                money
                value={x.bankPersonal}
                onChange={(bankPersonal) => set({ bankPersonal })}
                max={10_000_000_000}
                placeholder={estimate.personal ? plainMoney(estimate.personal) : undefined}
                hint="فارغ يعني تقديرنا من الراتب"
              />
            )}
          </div>
        </section>

        <section className="tile form-tile">
          <h2 className="form-title">
            <i>4</i>أتعابنا
          </h2>
          <div className="fields">
            <NumberField
              label="على السداد"
              suffix="%"
              decimals={1}
              max={100}
              value={x.fee.settlePct}
              onChange={(pct) => setFee({ settlePct: pct ?? 0 })}
              hint={ready ? `= ${ltr(plainMoney(study.feeSettle))}` : undefined}
            />
            <NumberField
              label="على استخراج التمويل"
              suffix="%"
              decimals={1}
              max={100}
              value={x.fee.financePct}
              onChange={(pct) => setFee({ financePct: pct ?? 0 })}
              hint={ready ? `= ${ltr(plainMoney(study.feeFinance))}` : undefined}
            />
          </div>
          {ready && (
            <p className="suggest">
              <span>
                المقترح لهذا الملف <b>{percent(study.suggestedPct)}</b>
                {study.suggestedReasons.length > 0 && `، بسبب ${study.suggestedReasons.map((reason) => FEE_REASON[reason]).join("، ")}`}
                <small>
                  الحدود من {percent(FEE_MIN)} إلى {percent(FEE_MAX)}
                </small>
              </span>
              {(x.fee.settlePct !== study.suggestedPct || x.fee.financePct !== study.suggestedPct) && (
                <button type="button" className="add-chip" onClick={() => setFee({ settlePct: study.suggestedPct, financePct: study.suggestedPct })}>
                  طبّقه
                </button>
              )}
            </p>
          )}
        </section>

        <details className="tile ledger">
          <summary>
            افتراضات الحساب
            <ChevronIcon />
          </summary>
          <div className="form-more">
          <div className="fields">
            {st.mortgage && (
              <>
                <NumberField label="هامش العقاري السنوي" suffix="%" decimals={2} max={30} value={x.mortgageApr} onChange={(n) => set({ mortgageApr: n ?? 0 })} hint="متناقص" />
                <NumberField label="التمويل إلى قيمة العقار" suffix="%" decimals={1} max={100} value={x.ltvPct} onChange={(n) => set({ ltvPct: n ?? 0 })} />
                <NumberField label="أقصى عمر بنهاية العقاري" suffix="سنة" max={90} grouped={false} value={x.mortgageMaxAge} onChange={(n) => set({ mortgageMaxAge: n ?? 0 })} />
                <NumberField label="أقصى مدة للعقاري" suffix="شهراً" max={420} grouped={false} value={x.mortgageMaxMonths} onChange={(n) => set({ mortgageMaxMonths: n ?? 0 })} />
                <NumberField label="ضريبة الإفراغ لطرفنا" suffix="%" decimals={2} max={100} value={x.transferTaxPct} onChange={(n) => set({ transferTaxPct: n ?? 0 })} />
                <NumberField label="ضريبة البيع للبنك" suffix="%" decimals={2} max={100} value={x.saleTaxPct} onChange={(n) => set({ saleTaxPct: n ?? 0 })} hint="صفر للمسكن الأول" />
              </>
            )}
            {st.personal && (
              <>
                <NumberField label="هامش الشخصي السنوي" suffix="%" decimals={2} max={30} value={x.personalFlat} onChange={(n) => set({ personalFlat: n ?? 0 })} hint="ثابت" />
                <NumberField label="مدة الشخصي" suffix="شهراً" max={120} grouped={false} value={x.personalMonths} onChange={(n) => set({ personalMonths: n ?? 0 })} />
                <TextField label="جهة التمويل الشخصي" value={x.personalLender ?? ""} onChange={(lender) => set({ personalLender: lender || null, personalCeiling: null })} maxLength={60} />
                <SelectField
                  label="نوعها"
                  value={(x.personalLenderKind ?? "") as LenderKind | ""}
                  onChange={(kind) => set({ personalLenderKind: kind || null })}
                  options={NO_LENDER_KIND}
                />
              </>
            )}
            <NumberField label="تكاليف ثابتة" money max={10_000_000} value={x.fixedCosts} onChange={(n) => set({ fixedCosts: n ?? 0 })} hint="تقييم، سعي، رسوم" />
            <NumberField label="مبلغ مقطوع فوق الأتعاب" money max={10_000_000} value={x.fee.fixed} onChange={(n) => setFee({ fixed: n ?? 0 })} />
            <SelectField label="نسبة التمويل تُحسب على" value={x.fee.financeBase} onChange={(financeBase) => setFee({ financeBase })} options={FINANCE_BASE} />
          </div>
          <Check label="نسبة السداد تشمل المخالصات" checked={x.fee.settleIncludesPayoff} onChange={(settleIncludesPayoff) => setFee({ settleIncludesPayoff })} />
          <label className="field" data-wide="true">
            <span className="field-label">ملاحظات</span>
            <textarea className="field-input field-area" maxLength={4000} value={x.notes} onChange={(event) => set({ notes: event.target.value })} placeholder="نتيجة التفاوض، رد البنك، ما اتُّفق عليه مع العميل" />
          </label>
          </div>
        </details>
      </div>

      <aside className="result" data-verdict={ready ? study.verdict : "empty"}>
        <div aria-live="polite">
          <p className="label">النتيجة الآن</p>
          {ready ? (
            <>
              <h2 className="result-say">{VERDICT[study.verdict]}</h2>
              {figure}
              <dl className="result-rows">
                <div>
                  <dt>رأس المال منا</dt>
                  <dd className="num">{plainMoney(study.capital)}</dd>
                </div>
                <div>
                  <dt>أتعابنا</dt>
                  <dd className="num">{plainMoney(study.fee)}</dd>
                </div>
                <div>
                  <dt>
                    التمويل الجديد <small>{study.financing.source === "bank" ? "عرض البنك" : "تقدير"}</small>
                  </dt>
                  <dd className="num">{plainMoney(study.summary.totalFinancing)}</dd>
                </div>
              </dl>
              {notes.map((risk) => (
                <p key={risk.code} className="result-note" data-level={risk.level}>
                  {riskText(risk)}
                </p>
              ))}
            </>
          ) : (
            <p className="result-empty">تظهر النتيجة مع أول التزام تضيفه، وتتغير مع كل رقم.</p>
          )}
        </div>
        <div className="result-actions">
          {error && (
            <p className="result-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--coral" disabled={pending} aria-busy={pending}>
            {saveLabel}
          </button>
          <Link className="result-cancel" href={dealId == null ? "/deals" : `/deals/${dealId}`}>
            إلغاء
          </Link>
        </div>
      </aside>

      <div className="result-bar" data-verdict={ready ? study.verdict : "empty"}>
        <p>
          {ready ? (
            <>
              <span>{closes ? "يبقى للعميل" : VERDICT[study.verdict]}</span>
              {study.verdict !== "needs_info" && <b className="num">{plainMoney(Math.abs(study.clientNet))}</b>}
            </>
          ) : (
            <span>أضف التزاماً لتظهر النتيجة</span>
          )}
        </p>
        <button type="submit" className="btn btn--coral" disabled={pending} aria-busy={pending}>
          {saveLabel}
        </button>
        {error && (
          <p className="result-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
