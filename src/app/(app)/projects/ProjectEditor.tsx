"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { ltr, millions, percent, plainMillions, plainMoney } from "@/copy/format";
import { alertTitle, BORROWER_TYPE, criticalGaps, DEED, PROJECT_TYPE, PROJECT_VERDICT, projectError, PURPOSE } from "@/copy/project";
import { projectStudy, type ProjectFacts } from "@/domain/project";
import { Check, NumberField, TextField } from "@/ui/fields";
import { saveProjectForm } from "./actions";

const AMOUNT_MAX = 100_000_000_000;

/** One choice out of a few, all visible. Nothing chosen means not known yet, and a second tap takes the choice back. */
function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T | null; onChange: (value: T | null) => void; options: Record<T, string> }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {(Object.keys(options) as T[]).map((key) => (
          <button key={key} type="button" role="radio" aria-checked={key === value} onClick={() => onChange(key === value ? null : key)}>
            {options[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A day picked from a calendar. Empty is `null`. */
function DayField({ label, value, onChange, max }: { label: string; value: string | null; onChange: (value: string | null) => void; max: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-box">
        <input id={id} type="date" className="field-input num" dir="ltr" max={max} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
      </div>
    </div>
  );
}

/** A large amount said the short way under its field, so a missing or an extra zero is seen at once. */
const said = (amount: number | null): string | undefined => (amount != null && amount >= 1_000_000 ? plainMillions(amount) : undefined);

/**
 * What is known about a project, typed in four steps. The study runs here as each number is typed,
 * and the server works it out again when the form is saved.
 */
export function ProjectEditor({
  clientId,
  owner: knownOwner,
  requested: knownRequested,
  facts: known,
  today,
}: {
  /** The project's file, or null for a new project. */
  clientId: number | null;
  owner: string;
  requested: number | null;
  facts: ProjectFacts;
  /** Today in Riyadh, yyyy-mm-dd, from the server: a valuation is not dated after it. */
  today: string;
}) {
  const [owner, setOwner] = useState(knownOwner);
  const [phone, setPhone] = useState("");
  const [requested, setRequested] = useState(knownRequested);
  const [x, setX] = useState(known);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<ProjectFacts>) => setX((prev) => ({ ...prev, ...patch }));

  const study = useMemo(() => projectStudy(x, requested ?? 0), [x, requested]);
  const hotel = x.projectType === "hotel";
  const ready = !!requested || !!x.landValue || !!x.constructionCost;
  const missing = criticalGaps(study);
  const notes = study.alerts.filter((alert) => alert.level !== "info").slice(0, 2);
  const saveLabel = clientId == null ? "احفظ المشروع" : "احفظ التعديل";

  function save() {
    if (owner.trim().length < 2) {
      setError("اكتب اسم المالك.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveProjectForm({ clientId, phone: clientId == null ? phone.trim() || null : null, project: { owner: owner.trim(), requested: requested ?? 0, facts: x } });
      if (result?.error) setError(projectError(result.error, result.params));
    });
  }

  /** The share that answers first: what is asked for against what the land is worth. */
  const share = study.ltv != null && requested ? percent(study.ltv) : null;

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
            <i>1</i>المالك
          </h2>
          <div className="fields fields--owner">
            <TextField label="الاسم" value={owner} onChange={setOwner} autoFocus={clientId == null} />
            {clientId == null && <TextField label="الجوال" typed="tel" value={phone} onChange={setPhone} placeholder="05xxxxxxxx" maxLength={20} hint="اختياري" />}
            <Choice label="من يقترض" value={x.borrowerType} onChange={(borrowerType) => set({ borrowerType })} options={BORROWER_TYPE} />
          </div>
        </section>

        <section className="tile form-tile">
          <h2 className="form-title">
            <i>2</i>الأرض
          </h2>
          <div className="fields">
            <TextField label="المدينة" value={x.city ?? ""} onChange={(city) => set({ city: city || null })} maxLength={60} />
            <TextField label="الحي" value={x.district ?? ""} onChange={(district) => set({ district: district || null })} maxLength={80} />
            <NumberField label="المساحة" suffix="م²" value={x.landArea} onChange={(landArea) => set({ landArea })} max={100_000_000} />
            <NumberField
              label="قيمة الأرض"
              money
              value={x.landValue}
              onChange={(landValue) => set({ landValue })}
              max={AMOUNT_MAX}
              hint={study.pricePerM2 != null ? `${said(x.landValue) ? `${said(x.landValue)}، ` : ""}المتر ${ltr(plainMoney(study.pricePerM2))}` : said(x.landValue)}
            />
            <TextField label="من قيّمها" value={x.valuer ?? ""} onChange={(valuer) => set({ valuer: valuer || null })} maxLength={120} placeholder="اسم المقيّم المعتمد" />
            <DayField label="تاريخ التقييم" value={x.valuationDate} onChange={(valuationDate) => set({ valuationDate })} max={today} />
          </div>
          <Choice label="الصك" value={x.deed} onChange={(deed) => set({ deed })} options={DEED} />
          <div className="checks">
            <Check label="في المنطقة المركزية قرب الحرم" checked={x.nearHaram} onChange={(nearHaram) => set({ nearHaram })} />
            <Check label="عليها رهن قائم" checked={x.existingLien} onChange={(existingLien) => set({ existingLien })} />
          </div>
        </section>

        <section className="tile form-tile">
          <h2 className="form-title">
            <i>3</i>المشروع
          </h2>
          <Choice label="نوعه" value={x.projectType} onChange={(projectType) => set({ projectType })} options={PROJECT_TYPE} />
          <div className="fields">
            <NumberField label="تكلفة البناء" money value={x.constructionCost} onChange={(constructionCost) => set({ constructionCost })} max={AMOUNT_MAX} hint={said(x.constructionCost)} />
            <NumberField label="مسطحات البناء" suffix="م²" value={x.gfa} onChange={(gfa) => set({ gfa })} max={100_000_000} />
            {hotel && (
              <>
                <NumberField label="عدد الغرف" suffix="غرفة" value={x.keys} onChange={(keys) => set({ keys })} max={100_000} />
                <NumberField label="سعر الليلة" money value={x.adr} onChange={(adr) => set({ adr })} max={1_000_000} hint="المتوسط على السنة" />
                <NumberField label="الإشغال" suffix="%" decimals={1} value={x.occupancy} onChange={(occupancy) => set({ occupancy })} max={100} hint="نسبة الليالي المباعة" />
              </>
            )}
          </div>
          <div className="checks">
            <Check label="له رخصة بناء" checked={x.hasPermit} onChange={(hasPermit) => set({ hasPermit })} />
            <Check label="له دراسة جدوى" checked={x.hasFeasibility} onChange={(hasFeasibility) => set({ hasFeasibility })} />
          </div>
        </section>

        <section className="tile form-tile">
          <h2 className="form-title">
            <i>4</i>التمويل
          </h2>
          <Choice label="لماذا يطلبه" value={x.purpose} onChange={(purpose) => set({ purpose })} options={PURPOSE} />
          <div className="fields">
            <NumberField label="المبلغ المطلوب" money value={requested} onChange={setRequested} max={AMOUNT_MAX} hint={said(requested)} />
            <NumberField label="سيولة يضعها المالك" money value={x.equityCash} onChange={(equityCash) => set({ equityCash })} max={AMOUNT_MAX} hint={said(x.equityCash) ?? "غير الأرض"} />
          </div>
        </section>
      </div>

      <aside className="result" data-verdict={ready ? (study.verdict === "weak" ? "short" : study.verdict) : "empty"}>
        <div aria-live="polite">
          <p className="label">الدراسة الآن</p>
          {ready ? (
            <>
              <h2 className="result-say">{PROJECT_VERDICT[study.verdict]}</h2>
              {share && (
                <p className="result-keep">
                  <span>المطلوب من قيمة الأرض</span>
                  <b key={share} className="num tick">
                    {share}
                  </b>
                </p>
              )}
              <dl className="result-rows">
                {study.totalCost != null && (
                  <div>
                    <dt>
                      تكلفة المشروع <small>الأرض والبناء</small>
                    </dt>
                    <dd>{millions(study.totalCost)}</dd>
                  </div>
                )}
                {study.equityPct != null && (
                  <div>
                    <dt>حصة المالك</dt>
                    <dd className="num">{percent(study.equityPct)}</dd>
                  </div>
                )}
                <div>
                  <dt>
                    ينقص الملف <small>أساسي</small>
                  </dt>
                  <dd className="num">{missing}</dd>
                </div>
              </dl>
              {notes.map((alert) => (
                <p key={alert.code} className="result-note" data-level={alert.level}>
                  {alertTitle(alert)}
                </p>
              ))}
            </>
          ) : (
            <p className="result-empty">تظهر الدراسة مع أول رقم تكتبه، وتتغير مع كل رقم.</p>
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
          <Link className="result-cancel" href={clientId == null ? "/clients" : `/clients/${clientId}/project`}>
            إلغاء
          </Link>
        </div>
      </aside>

      <div className="result-bar" data-verdict={ready && study.verdict === "weak" ? "short" : undefined}>
        <p>
          {ready ? (
            <>
              <span>{PROJECT_VERDICT[study.verdict]}</span>
              {share && <b className="num">{share}</b>}
            </>
          ) : (
            <span>اكتب الأرقام لتظهر الدراسة</span>
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
