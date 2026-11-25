"use client";

import Link from "next/link";
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { accountError, GUARD, passkeyProblem } from "@/copy/auth";
import { PASSWORD_MIN } from "@/domain/auth";
import { digitsOf } from "@/domain/shared/phone";
import { initial } from "@/copy/format";
import { BackIcon, CheckIcon, CopyIcon, FingerprintIcon } from "@/ui/icons";
import { PasswordField } from "@/ui/PasswordField";
import {
  changePassword,
  deletePasskey,
  finishAuthenticator,
  finishPasskey,
  signOutElsewhere,
  startAuthenticator,
  startPasskey,
  stopAuthenticator,
  type AccountAnswer,
  type AuthenticatorStart,
} from "./actions";
import { Gate } from "./Gate";

/** What the page shows, already worded: the screen formats nothing itself. */
export interface AccountView {
  demo: boolean;
  name: string;
  role: string;
  email: string | null;
  /** How this session was opened, as it reads after "دخلت". */
  entered: string;
  authenticator: boolean;
  codeStopped: boolean;
  /** Passkeys can be made on this address. */
  passkeysOn: boolean;
  passkeys: { id: number; name: string; added: string; used: string | null }[];
  devices: { name: string; since: string; how: string; current: boolean }[];
  /** The screens that run the office, for a person who may open them. */
  office: { users: boolean; audit: boolean; fees: boolean; month: boolean };
}

type Way = "password" | "authenticator" | "passkey" | "devices";
type Open = "password" | "authenticator" | "authenticator-off" | null;
type Said = { way: Way; text: string; bad?: boolean } | null;

function Note({ said, way }: { said: Said; way: Way }) {
  if (said?.way !== way) return null;
  return (
    <p key={said.text} role={said.bad ? "alert" : "status"} className="said" data-bad={said.bad || undefined}>
      {!said.bad && <CheckIcon size={16} />}
      {said.text}
    </p>
  );
}

/** One way into the account: whether it is on, what it does, and the one thing to do about it. */
function WayRow({ on, name, state, say, action, children }: { on: boolean; name: string; state: string; say: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <li className="door" data-on={on || undefined}>
      <div className="door-head">
        <i className="door-node" aria-hidden="true">
          {on && <CheckIcon size={16} />}
        </i>
        <div className="door-text">
          <h3 className="door-name">
            {name}
            <span className="door-state">{state}</span>
          </h3>
          <p className="door-say">{say}</p>
        </div>
        {action}
      </div>
      {children}
    </li>
  );
}

function PasswordPanel({ email, busy, onSave, onCancel }: { email: string | null; busy: boolean; onSave: (current: string, next: string) => void; onCancel: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const short = next.length > 0 && [...next].length < PASSWORD_MIN;
  return (
    <form
      className="door-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!short) onSave(current, next);
      }}
    >
      {/* Tells a password manager whose password this is, so it updates the right entry. */}
      {email && <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />}
      <div className="door-fields">
        <PasswordField label="الحالية" autoComplete="current-password" required autoFocus value={current} onChange={(event) => setCurrent(event.target.value)} />
        <PasswordField
          label="الجديدة"
          autoComplete="new-password"
          required
          value={next}
          onChange={(event) => setNext(event.target.value)}
          hint={short ? `بقي ${PASSWORD_MIN - [...next].length} من عشر خانات.` : "عشر خانات على الأقل."}
        />
      </div>
      <div className="door-actions">
        <button type="submit" className="btn btn--navy" disabled={busy || short} aria-busy={busy}>
          احفظ
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          تراجع
        </button>
      </div>
    </form>
  );
}

/** The key in fours, as authenticator apps show it. */
const inFours = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

function LinkPanel({ setup, busy, onCode, onCancel }: { setup: AuthenticatorStart; busy: boolean; onCode: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const codeId = useId();
  const { qr, secret = "", uri } = setup;

  function copy() {
    void navigator.clipboard?.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <form
      className="door-panel link"
      onSubmit={(event) => {
        event.preventDefault();
        onCode(code);
      }}
    >
      {qr && (
        <div className="link-qr">
          <svg viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} role="img" aria-label="رمز الربط" shapeRendering="crispEdges">
            <path d={qr.path} fill="currentColor" />
          </svg>
        </div>
      )}
      <ol className="link-steps">
        <li>
          <b>1</b>
          <span>
            افتح تطبيق مصادقة على جوالك، مثل <span className="link-app">Google Authenticator</span>، وامسح الرمز.{" "}
            <a className="link-open" href={uri}>
              تقرأ من الجوال نفسه؟ افتح التطبيق
            </a>
          </span>
        </li>
        <li>
          <b>2</b>
          <div className="field">
            <label htmlFor={codeId}>اكتب الأرقام الستة التي يعرضها.</label>
            <div className="field-box">
              <input
                id={codeId}
                className="field-input num login-code"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                placeholder="000000"
                required
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  // Six digits are the whole answer: send them without making the person reach for the button.
                  if (digitsOf(event.target.value).length === 6 && !busy) onCode(event.target.value);
                }}
              />
            </div>
          </div>
        </li>
      </ol>
      <div className="link-key">
        <span>أو أدخل المفتاح يدوياً</span>
        <code dir="ltr">{inFours(secret)}</code>
        <button type="button" className="link-copy" onClick={copy} aria-label="انسخ المفتاح">
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? "نُسخ" : "انسخ"}
        </button>
      </div>
      <div className="door-actions">
        <button type="submit" className="btn btn--navy" disabled={busy} aria-busy={busy}>
          فعّل
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          تراجع
        </button>
      </div>
    </form>
  );
}

export function Account({ view }: { view: AccountView }) {
  const [open, setOpen] = useState<Open>(null);
  const [said, setSaid] = useState<Said>(null);
  const [gate, setGate] = useState<{ retry: () => void } | null>(null);
  const [setup, setSetup] = useState<AuthenticatorStart | null>(null);
  const [dropping, setDropping] = useState<number | null>(null);
  const [supported, setSupported] = useState(true);
  const [busy, start] = useTransition();

  useEffect(() => {
    setSupported(typeof window.PublicKeyCredential === "function");
  }, []);

  /**
   * Runs one change. When the server wants the password first, the box opens and the same change runs
   * again once the password is accepted, so the person does not press the button twice.
   */
  function attempt<T extends AccountAnswer>(way: Way, action: () => Promise<T>, then: (answer: T) => void | Promise<void>) {
    setSaid(null);
    start(async () => {
      const answer = await action();
      if (answer.error === "CONFIRM_FIRST") return setGate({ retry: () => attempt(way, action, then) });
      if (answer.error) return setSaid({ way, text: accountError(answer.error), bad: true });
      await then(answer);
    });
  }

  const close = () => {
    setOpen(null);
    setSetup(null);
  };

  const addPasskey = () =>
    attempt("passkey", startPasskey, async ({ options }) => {
      if (!options) return;
      let response;
      try {
        const { startRegistration } = await import("@simplewebauthn/browser");
        response = await startRegistration({ optionsJSON: options });
      } catch (error) {
        const text = passkeyProblem(error, "add");
        if (text) setSaid({ way: "passkey", text, bad: true });
        return;
      }
      const answer = await finishPasskey(response);
      if (answer.error) return setSaid({ way: "passkey", text: accountError(answer.error), bad: true });
      setSaid({ way: "passkey", text: "أُضيف هذا الجهاز. ادخل منه ببصمتك في المرة القادمة." });
    });

  const ways = 1 + (view.authenticator ? 1 : 0) + (view.passkeys.length ? 1 : 0);
  const guard = GUARD[ways as 1 | 2 | 3];
  const others = view.devices.filter((device) => !device.current).length;
  const mayAddKey = view.demo || (view.passkeysOn && supported);

  return (
    <div className="bento account">
      <section className="tile tile--card">
        <div className="card-who">
          <i className="card-face" aria-hidden="true">
            {initial(view.name)}
          </i>
          <div className="card-text">
            <h2 className="card-name">{view.name}</h2>
            <p className="card-role">{view.role}</p>
          </div>
        </div>
        {view.email && (
          <dl className="card-facts">
            <div>
              <dt>البريد</dt>
              <dd dir="ltr">{view.email}</dd>
            </div>
            {view.entered && (
              <div>
                <dt>دخلت هذه المرة</dt>
                <dd>{view.entered}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="card-guard" data-ways={ways}>
          <p className="label">حماية الحساب</p>
          <p className="card-level" key={guard.level}>
            {guard.level}
          </p>
          <p className="card-say">{guard.say}</p>
          <ol className="steps">
            <li data-state="done">كلمة المرور</li>
            <li data-state={view.authenticator ? "done" : undefined}>تطبيق المصادقة</li>
            <li data-state={view.passkeys.length ? "done" : undefined}>البصمة</li>
          </ol>
        </div>
      </section>

      <section className="tile tile--doors">
        <p className="label">طرق الدخول</p>
        <ul className="doors">
          <WayRow
            on
            name="كلمة المرور"
            state="تعمل"
            say="تفتح حسابك، وتؤكد بها كل تغيير هنا."
            action={
              open !== "password" && (
                <button type="button" className="btn btn--soft" onClick={() => (close(), setOpen("password"))}>
                  غيّرها
                </button>
              )
            }
          >
            {open === "password" && (
              <PasswordPanel
                email={view.email}
                busy={busy}
                onCancel={close}
                onSave={(current, next) =>
                  attempt(
                    "password",
                    () => changePassword(current, next),
                    () => {
                      close();
                      setSaid({ way: "password", text: "تغيّرت كلمة المرور، وخرجت بقية الأجهزة." });
                    },
                  )
                }
              />
            )}
            <Note said={said} way="password" />
          </WayRow>

          <WayRow
            on={view.authenticator}
            name="تطبيق المصادقة"
            state={view.authenticator ? "يعمل" : "متوقف"}
            say={
              view.authenticator
                ? "يُطلب رمزه بعد كلمة المرور في كل دخول."
                : "رمز من ستة أرقام من تطبيق على جوالك، يُطلب بعد كلمة المرور."
            }
            action={
              open !== "authenticator" &&
              open !== "authenticator-off" &&
              (view.authenticator ? (
                <button type="button" className="btn btn--soft" onClick={() => (close(), setOpen("authenticator-off"))}>
                  أوقفه
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--navy"
                  disabled={busy}
                  onClick={() =>
                    attempt("authenticator", startAuthenticator, (answer) => {
                      setSetup(answer);
                      setOpen("authenticator");
                    })
                  }
                >
                  اربط التطبيق
                </button>
              ))
            }
          >
            {open === "authenticator" && setup && (
              <LinkPanel
                setup={setup}
                busy={busy}
                onCancel={close}
                onCode={(code) =>
                  attempt(
                    "authenticator",
                    () => finishAuthenticator(code),
                    () => {
                      close();
                      setSaid({ way: "authenticator", text: "تم الربط. سيُطلب الرمز بعد كلمة المرور في دخولك القادم." });
                    },
                  )
                }
              />
            )}
            {open === "authenticator-off" && (
              <div className="door-panel">
                <p className="door-warn">بعد الإيقاف تكفي كلمة المرور وحدها لفتح حسابك.</p>
                <div className="door-actions">
                  <button
                    type="button"
                    className="btn btn--coral"
                    disabled={busy}
                    onClick={() =>
                      attempt("authenticator", stopAuthenticator, () => {
                        close();
                        setSaid({ way: "authenticator", text: "أُوقف تطبيق المصادقة." });
                      })
                    }
                  >
                    أوقفه
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={close}>
                    تراجع
                  </button>
                </div>
              </div>
            )}
            {view.codeStopped && <p className="door-warn">الدخول بالرمز وحده موقوف بعد محاولات خاطئة. يعود بعد دخولك القادم بكلمة المرور.</p>}
            <Note said={said} way="authenticator" />
          </WayRow>

          <WayRow
            on={view.passkeys.length > 0}
            name="البصمة"
            state={view.passkeys.length ? "تعمل" : "متوقفة"}
            say={
              mayAddKey || view.passkeys.length
                ? "ادخل ببصمتك أو وجهك أو قفل جهازك، بلا كلمة مرور. لكل جهاز مفتاحه."
                : view.passkeysOn
                  ? "هذا المتصفح لا يدعم الدخول بالبصمة."
                  : "غير متاحة على هذا العنوان."
            }
            action={
              mayAddKey && (
                <button type="button" className="btn btn--navy" disabled={busy} onClick={addPasskey}>
                  <FingerprintIcon size={18} />
                  أضف هذا الجهاز
                </button>
              )
            }
          >
            {view.passkeys.length > 0 && (
              <ul className="lines">
                {view.passkeys.map((key) => (
                  <li key={key.id} className="line">
                    <div className="line-text">
                      <b>{key.name}</b>
                      <small>{key.used ? `أضيف ${key.added} · آخر دخول ${key.used}` : `أضيف ${key.added}`}</small>
                    </div>
                    {dropping === key.id ? (
                      <span className="line-ask">
                        <button
                          type="button"
                          className="btn btn--coral"
                          disabled={busy}
                          onClick={() =>
                            attempt(
                              "passkey",
                              () => deletePasskey(key.id),
                              () => {
                                setDropping(null);
                                setSaid({ way: "passkey", text: "حُذف المفتاح." });
                              },
                            )
                          }
                        >
                          احذف
                        </button>
                        <button type="button" className="btn btn--ghost" onClick={() => setDropping(null)}>
                          تراجع
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn--ghost" onClick={() => setDropping(key.id)}>
                        احذف
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Note said={said} way="passkey" />
          </WayRow>
        </ul>
      </section>

      <section className="tile tile--devices">
        <p className="label">أنت داخل الآن من</p>
        <ul className="lines">
          {view.devices.map((device, n) => (
            <li key={n} className="line">
              <div className="line-text">
                <b>{device.name}</b>
                <small>{device.how ? `دخل ${device.since} ${device.how}` : `دخل ${device.since}`}</small>
              </div>
              {device.current && <span className="tag">هذا الجهاز</span>}
            </li>
          ))}
        </ul>
        {others > 0 && (
          <button type="button" className="btn btn--soft" disabled={busy} onClick={() => attempt("devices", signOutElsewhere, () => setSaid({ way: "devices", text: "خرجت بقية الأجهزة." }))}>
            اخرج من بقية الأجهزة
          </button>
        )}
        <Note said={said} way="devices" />
      </section>

      {(view.office.users || view.office.audit || view.office.fees || view.office.month) && (
        <nav className="tile tile--office" aria-label="إدارة المكتب">
          <p className="label">إدارة المكتب</p>
          <div className="office">
            {view.office.users && (
              <Link className="office-door" href="/users">
                <b>الحسابات</b>
                <span>من يدخل مسار، وما يحق لكل واحد.</span>
                <BackIcon />
              </Link>
            )}
            {view.office.audit && (
              <Link className="office-door" href="/audit">
                <b>سجل التدقيق</b>
                <span>كل ما جرى في النظام ومن قام به.</span>
                <BackIcon />
              </Link>
            )}
            {view.office.month && (
              <Link className="office-door" href="/reports">
                <b>تقرير الشهر</b>
                <span>ما دخل، وما أُغلق وأتعابه، وما ردّت به الجهات.</span>
                <BackIcon />
              </Link>
            )}
            {view.office.fees && (
              <Link className="office-door" href="/settings/fees">
                <b>سياسة الأتعاب</b>
                <span>النسبة التي تبدأ بها كل صفقة، والحدان.</span>
                <BackIcon />
              </Link>
            )}
          </div>
        </nav>
      )}

      {gate && (
        <Gate
          say="اكتب كلمة المرور لتغيّر طرق الدخول."
          onClose={() => setGate(null)}
          onDone={() => {
            const { retry } = gate;
            setGate(null);
            retry();
          }}
        />
      )}
    </div>
  );
}
