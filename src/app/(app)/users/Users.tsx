"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { initial } from "@/copy/format";
import { usersError, type UserStanding } from "@/copy/users";
import { PASSWORD_MIN, type Role } from "@/domain/auth";
import { Segmented, TextField } from "@/ui/fields";
import { CheckIcon, ChevronIcon, PlusIcon } from "@/ui/icons";
import { PasswordField } from "@/ui/PasswordField";
import { Gate } from "../account/Gate";
import { addUser, giveNewPassword, resetUserSignIn, saveUser, setUserActive, unlockUserNow, type UsersAnswer } from "./actions";

/** One account as the screen shows it, already worded: the screen formats nothing itself. */
export interface UserView {
  id: number;
  name: string;
  email: string;
  role: Role;
  standing: UserStanding;
  standingSay: string;
  /** The ways in beyond the password, in words. */
  ways: string;
  /** There is an authenticator or a passkey to take away. */
  hasWays: boolean;
  seen: string;
  /** "داخل الآن من جهازين", or empty. */
  inNow: string;
  /** The sign-in mobile as a person types it. */
  phone: string;
  /** The account of the person looking at the screen. */
  me: boolean;
}

export interface RoleView {
  role: Role;
  name: string;
  say: string;
  /** How many people can use the role now. */
  people: number;
}

type Panel = "password" | "reset" | "stop" | null;
type Said = { about: number | "new"; text: string; bad?: boolean } | null;

const passwordHint = `${PASSWORD_MIN} خانات على الأقل.`;

/** A new person: who they are, what they may do, and the first password, which the admin hands over. */
function NewAccount({ roles, busy, refused, onAdd, onClose }: { roles: RoleView[]; busy: boolean; refused: string | null; onAdd: (input: { name: string; email: string; role: string; phone: string; password: string }) => void; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("officer");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const names = Object.fromEntries(roles.map((line) => [line.role, line.name])) as Record<Role, string>;

  useEffect(() => {
    box.current?.showModal();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd({ name, email, role, phone, password });
  }

  return (
    <dialog ref={box} className="ask ask--wide" aria-labelledby={title} onClose={onClose}>
      <form onSubmit={submit} className="ask-form">
        <h2 id={title} className="ask-title">
          حساب جديد
        </h2>
        <div className="fields fields--pair">
          <TextField label="الاسم" value={name} onChange={setName} maxLength={80} autoFocus />
          <TextField label="البريد الإلكتروني" typed="email" value={email} onChange={setEmail} maxLength={200} />
        </div>
        <div className="field">
          <span className="field-label">الدور</span>
          <Segmented label="الدور" value={role} onChange={setRole} options={names} />
          <small className="field-hint">{roles.find((line) => line.role === role)?.say}</small>
        </div>
        <div className="fields fields--pair">
          <TextField label="جوال الدخول" typed="tel" value={phone} onChange={setPhone} placeholder="05xxxxxxxx" maxLength={20} hint="يصله رمز الدخول بواتساب. يصح تركه فارغاً." />
          <PasswordField label="كلمة المرور الأولى" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} hint={`${passwordHint} أعطه إياها بنفسك.`} />
        </div>
        {refused && (
          <p key={refused} role="alert" className="said" data-bad>
            {refused}
          </p>
        )}
        <div className="ask-actions">
          <button type="submit" className="btn btn--navy" disabled={busy} aria-busy={busy}>
            أنشئ الحساب
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => box.current?.close()}>
            إلغاء
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** What can be changed on one account. It opens under the person's line, one person at a time. */
function Member({ person, roleNames, roleSay, busy, said, run }: { person: UserView; roleNames: Record<Role, string>; roleSay: Record<Role, string>; busy: boolean; said: Said; run: (action: () => Promise<UsersAnswer>, done: string, then?: () => void) => void }) {
  const [role, setRole] = useState(person.role);
  const [phone, setPhone] = useState(person.phone);
  const [panel, setPanel] = useState<Panel>(null);
  const [password, setPassword] = useState("");
  const changed = role !== person.role || phone.trim() !== person.phone;

  // The fields follow what is kept: after a save they show it as it was stored.
  useEffect(() => {
    setRole(person.role);
    setPhone(person.phone);
  }, [person.role, person.phone]);

  const close = () => {
    setPanel(null);
    setPassword("");
  };
  const note = said?.about === person.id && (
    <p key={said.text} role={said.bad ? "alert" : "status"} className="said" data-bad={said.bad || undefined}>
      {!said.bad && <CheckIcon size={16} />}
      {said.text}
    </p>
  );

  return (
    <div className="member-body">
      <form
        className="member-form"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => saveUser(person.id, { role, phone }), "حُفظ.");
        }}
      >
        {person.me ? (
          <p className="member-say">
            هذا حسابك. دورك يغيّره مدير آخر، وكلمة مرورك وطرق دخولك من{" "}
            <Link className="lede-link" href="/account">
              حسابي
            </Link>
            .
          </p>
        ) : (
          <div className="field">
            <span className="field-label">الدور</span>
            <Segmented label="الدور" value={role} onChange={setRole} options={roleNames} />
            <small className="field-hint">{roleSay[role]}</small>
          </div>
        )}
        <TextField label="جوال الدخول" typed="tel" value={phone} onChange={setPhone} placeholder="05xxxxxxxx" maxLength={20} hint="يصله رمز الدخول بواتساب." />
        <button type="submit" className="btn btn--navy" disabled={busy || !changed} aria-busy={busy}>
          احفظ
        </button>
      </form>

      {!person.me && (
        <div className="member-acts">
          {person.standing === "locked" && (
            <button type="button" className="member-act" disabled={busy} onClick={() => run(() => unlockUserNow(person.id), "فُتح القفل.")}>
              افتح القفل
            </button>
          )}
          <button type="button" className="member-act" aria-expanded={panel === "password"} onClick={() => setPanel(panel === "password" ? null : "password")}>
            كلمة مرور جديدة
          </button>
          {person.hasWays && (
            <button type="button" className="member-act" aria-expanded={panel === "reset"} onClick={() => setPanel(panel === "reset" ? null : "reset")}>
              صفّر طرق الدخول
            </button>
          )}
          {person.standing === "stopped" ? (
            <button type="button" className="member-act" disabled={busy} onClick={() => run(() => setUserActive(person.id, true), "عاد الحساب يعمل.")}>
              أعد تشغيل الحساب
            </button>
          ) : (
            <button type="button" className="member-act" data-tone="bad" aria-expanded={panel === "stop"} onClick={() => setPanel(panel === "stop" ? null : "stop")}>
              أوقف الحساب
            </button>
          )}
        </div>
      )}

      {panel === "password" && (
        <form
          className="member-panel"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => giveNewPassword(person.id, password), "تغيّرت كلمة المرور وخرجت أجهزته.", close);
          }}
        >
          <PasswordField label="كلمة المرور الجديدة" autoComplete="new-password" required autoFocus value={password} onChange={(event) => setPassword(event.target.value)} hint={`${passwordHint} يخرج من كل أجهزته، فأعطه إياها بنفسك.`} />
          <div className="ask-actions">
            <button type="submit" className="btn btn--navy" disabled={busy} aria-busy={busy}>
              احفظها
            </button>
            <button type="button" className="btn btn--ghost" onClick={close}>
              إلغاء
            </button>
          </div>
        </form>
      )}
      {panel === "reset" && (
        <div className="member-panel">
          <p>تُحذف طرق دخوله الإضافية ({person.ways})، ويبقى له الدخول بكلمة المرور. يخرج من كل أجهزته.</p>
          <div className="ask-actions">
            <button type="button" className="btn btn--navy" disabled={busy} aria-busy={busy} onClick={() => run(() => resetUserSignIn(person.id), "صُفّرت طرق الدخول.", close)}>
              صفّرها
            </button>
            <button type="button" className="btn btn--ghost" onClick={close}>
              إلغاء
            </button>
          </div>
        </div>
      )}
      {panel === "stop" && (
        <div className="member-panel">
          <p>يخرج من كل أجهزته الآن، ولا يدخل حتى تعيد تشغيل حسابه. ما عمله يبقى في السجل.</p>
          <div className="ask-actions">
            <button type="button" className="btn btn--coral" disabled={busy} aria-busy={busy} onClick={() => run(() => setUserActive(person.id, false), "أُوقف الحساب.", close)}>
              أوقف الحساب
            </button>
            <button type="button" className="btn btn--ghost" onClick={close}>
              إلغاء
            </button>
          </div>
        </div>
      )}
      {note}
    </div>
  );
}

/** The people of the office and what each may do. */
export function Users({ people, roles }: { people: UserView[]; roles: RoleView[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState<Said>(null);
  const [gate, setGate] = useState<{ retry: () => void } | null>(null);
  const [busy, start] = useTransition();
  const roleNames = Object.fromEntries(roles.map((line) => [line.role, line.name])) as Record<Role, string>;
  const roleSay = Object.fromEntries(roles.map((line) => [line.role, line.say])) as Record<Role, string>;

  /**
   * Runs one change. When the server wants the password first, the box opens and the same change runs
   * again once the password is accepted, so the person does not press the button twice.
   */
  function attempt(about: number | "new", action: () => Promise<UsersAnswer>, done: string, then?: () => void) {
    setSaid(null);
    start(async () => {
      const answer = await action();
      if (answer.error === "CONFIRM_FIRST") return setGate({ retry: () => attempt(about, action, done, then) });
      if (answer.error) return setSaid({ about, text: usersError(answer.error), bad: true });
      then?.();
      setSaid({ about, text: done });
    });
  }

  return (
    <div className="bento">
      <section className="tile tile--staff" aria-label="الأشخاص">
        <div className="staff-head">
          <h2 className="label">الأشخاص</h2>
          <button
            type="button"
            className="btn btn--soft"
            onClick={() => {
              setSaid(null);
              setAdding(true);
            }}
          >
            <PlusIcon size={16} />
            حساب جديد
          </button>
        </div>
        {said?.about === "new" && !said.bad && !adding && (
          <p key={said.text} role="status" className="said">
            <CheckIcon size={16} />
            {said.text}
          </p>
        )}
        <ul className="staff">
          {people.map((person, index) => (
            <li key={person.id} className="member" data-open={open === person.id || undefined} data-standing={person.standing} style={{ animationDelay: `${Math.min(index, 10) * 0.05}s` }}>
              <button
                type="button"
                className="member-head"
                aria-expanded={open === person.id}
                onClick={() => {
                  setSaid(null);
                  setOpen(open === person.id ? null : person.id);
                }}
              >
                <span className="member-who" data-tone={person.me ? "hot" : undefined}>
                  <span className="avatar" aria-hidden="true">
                    {initial(person.name)}
                  </span>
                  <span>
                    <b>
                      {person.name}
                      {person.me && <span className="tag">أنت</span>}
                    </b>
                    <small dir="ltr">{person.email}</small>
                  </span>
                </span>
                <span className="member-role">
                  {roleNames[person.role]}
                  <small>{person.ways}</small>
                </span>
                <span className="member-seen">
                  {person.seen}
                  {person.inNow && <small>{person.inNow}</small>}
                </span>
                <span className="member-state">
                  {person.standing !== "working" && (
                    <span className="state" data-kind={person.standing === "stopped" ? "rejected" : "done"}>
                      {person.standingSay}
                    </span>
                  )}
                </span>
                <span className="member-end">
                  <ChevronIcon size={18} />
                </span>
              </button>
              {open === person.id && <Member person={person} roleNames={roleNames} roleSay={roleSay} busy={busy} said={said} run={(action, done, then) => attempt(person.id, action, done, then)} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="tile tile--roles" aria-label="الأدوار">
        <h2 className="label">من يفعل ماذا</h2>
        <ul className="roles">
          {roles.map((line) => (
            <li key={line.role}>
              <b>
                {line.name}
                <span className="num">{line.people}</span>
              </b>
              <p>{line.say}</p>
            </li>
          ))}
        </ul>
      </section>

      {adding && (
        <NewAccount
          roles={roles}
          busy={busy}
          refused={said?.about === "new" && said.bad ? said.text : null}
          onClose={() => setAdding(false)}
          onAdd={(input) => attempt("new", () => addUser(input), `أُنشئ حساب ${input.name.trim()}.`, () => setAdding(false))}
        />
      )}
      {gate && (
        <Gate
          say="اكتب كلمة مرورك لتغيّر حسابات غيرك."
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
