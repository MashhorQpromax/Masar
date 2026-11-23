import { describe, expect, it } from "vitest";
import { AUDIT_AREA, auditAction, auditDetail, eventsCount, NOBODY } from "@/copy/audit";
import { FINANCE_TYPE } from "@/copy/eligibility";
import { AUDIT_ACTIONS, AUDIT_AREA_NAMES } from "@/domain/audit";
import { STAGES } from "@/domain/deal";
import { PAPER_CODES } from "@/domain/documents";

const broken = /undefined|NaN|null|\[object|—|–/;
const strip = (text: string) => text.replace(/[⁦⁩]/g, "");

describe("what an event in the audit log is called", () => {
  it("names every event and every part of the office in Arabic", () => {
    const names = AUDIT_ACTIONS.map(auditAction);
    for (const [index, name] of names.entries()) {
      expect(name, AUDIT_ACTIONS[index]).toMatch(/[؀-ۿ]/);
      expect(name, AUDIT_ACTIONS[index]).not.toMatch(/[a-z_.]{3,}/);
      expect(name, AUDIT_ACTIONS[index]).not.toBe("حدث آخر");
    }
    // Two events never read as the same thing.
    expect(new Set(names).size).toBe(names.length);
    for (const area of AUDIT_AREA_NAMES) expect(AUDIT_AREA[area], area).toMatch(/[؀-ۿ]/);
    expect(new Set(Object.values(AUDIT_AREA)).size).toBe(AUDIT_AREA_NAMES.length);
  });

  it("still names an event from a newer build", () => {
    expect(auditAction("something.new")).toBe("حدث آخر");
    expect(auditDetail("something.new", { a: 1 })).toBe("");
    expect(NOBODY).toBe("بلا حساب");
  });
});

describe("the detail beside an event", () => {
  it("says how a person came in, and why a way in failed", () => {
    expect(auditDetail("login", { method: "password" })).toBe("بكلمة المرور");
    expect(auditDetail("login", { method: "password+totp" })).toBe("بكلمة المرور ورمز التطبيق");
    expect(auditDetail("login", { method: "passkey" })).toBe("بالبصمة");
    expect(auditDetail("login", { method: "whatsapp" })).toBe("برمز واتساب");
    expect(auditDetail("login_failed", { method: "password", inactive: true })).toBe("بكلمة المرور، الحساب موقوف");
    expect(auditDetail("login_failed", { method: "code", stopped: true })).toBe("برمز واتساب، الرمز موقوف لكثرة الخطأ");
    expect(strip(auditDetail("login_failed", { email: "someone@masar.example" }))).toBe("بريد لا حساب له: someone@masar.example");
    // An address is Latin text inside an Arabic line, so it is isolated.
    expect(auditDetail("login_failed", { email: "someone@masar.example" })).toContain("⁦someone@masar.example⁩");
    expect(auditDetail("login_code_sent", { channel: "whatsapp" })).toBe("");
    expect(auditDetail("login_code_sent", { channel: "whatsapp", failed: "131026" })).toBe("لم يُرسل");
  });

  it("says what changed on an account without saying a phone", () => {
    expect(auditDetail("user.create", { role: "analyst" })).toBe("محلل ائتماني");
    expect(auditDetail("user.update", { changed: ["role"], role: { from: "officer", to: "analyst" } })).toBe("من مسؤول علاقة إلى محلل ائتماني");
    expect(auditDetail("user.update", { changed: ["active"], active: false })).toBe("أُوقف");
    expect(auditDetail("user.update", { changed: ["active"], active: true })).toBe("عاد يعمل");
    expect(auditDetail("user.update", { changed: ["phone"] })).toBe("الجوال");
    expect(auditDetail("user.update", { changed: ["role", "phone"], role: { from: "viewer", to: "officer" } })).toBe("من مطّلع إلى مسؤول علاقة، الجوال");
    expect(auditDetail("user.signin_reset", { passkeys: 2, authenticator: true })).toBe("تطبيق المصادقة، مفتاحا مرور");
    expect(auditDetail("user.signin_reset", { passkeys: 0, authenticator: false })).toBe("");
    expect(auditDetail("user.password_reset", {})).toBe("");
  });

  it("says what changed on a file by the name of the field, never its value", () => {
    expect(auditDetail("client.contact", { changed: ["phone", "nationalId"] })).toBe("الجوال، رقم الهوية");
    expect(auditDetail("client.contact", { changed: ["phone"], adopted: 2, via: "inbox" })).toBe("الجوال، انضمت رسالتان، من الوارد");
    expect(auditDetail("client.update", { changed: ["salaryBank"] })).toBe("بنك الراتب");
    // A field this wording does not know is left out, not shown as a code.
    expect(auditDetail("client.update", { changed: ["somethingNew", "city"] })).toBe("المدينة");
    expect(auditDetail("client.reject", { reason: "  العجز لا يُغلق  " })).toBe("العجز لا يُغلق");
    expect(auditDetail("credit.report_review", { suspension: true, travelBan: true })).toBe("إيقاف خدمات، منع سفر");
    expect(auditDetail("credit.report_review", { suspension: false })).toBe("");
  });

  it("says a project was opened, or how much of it changed, and never a figure of it", () => {
    expect(auditDetail("project.save", { created: true })).toBe("مشروع جديد");
    expect(auditDetail("project.save", { changed: ["hasPermit"] })).toBe("تغيّر بيان واحد");
    expect(auditDetail("project.save", { changed: ["landValue", "requested"] })).toBe("تغيّر بيانان");
    expect(auditDetail("project.save", { changed: ["owner", "requested", "landValue", "purpose"] })).toBe("تغيّر 4 بيانات");
    expect(auditDetail("project.save", { changed: Array.from({ length: 12 }, (_, i) => `fact${i}`) })).toBe("تغيّر 12 بياناً");
    expect(auditDetail("project.save", { changed: [] })).toBe("");
    expect(auditDetail("project.save", {})).toBe("");
  });

  it("says where a deal moved to and which lender was chosen", () => {
    for (const [stage] of STAGES) {
      const text = auditDetail("deal.stage", { from: "study", to: stage });
      expect(text, stage).toMatch(/^إلى [؀-ۿ]/);
    }
    expect(auditDetail("deal.stage", { to: "nowhere" })).toBe("");
    expect(auditDetail("deal.route", { mortgage: { lender: "بنك الرياض" }, personal: { lender: "بنك الرياض" } })).toBe("بنك الرياض");
    expect(auditDetail("deal.route", { mortgage: { lender: "بنك الرياض" }, personal: { lender: "مصرف الراجحي" } })).toBe("بنك الرياض، مصرف الراجحي");
    expect(auditDetail("deal.route", { mortgage: null, personal: { lender: "مصرف الراجحي" } })).toBe("مصرف الراجحي");
    expect(auditDetail("deal.save", { structure: "mortgage_personal" })).toBe("");
  });

  it("names a paper by what it is called, never by its code", () => {
    expect(auditDetail("doc.upload", { paper: "id" })).toBe("الهوية الوطنية");
    expect(auditDetail("doc.upload", { paper: "id", via: "portal" })).toBe("الهوية الوطنية، من صفحة العميل");
    expect(auditDetail("doc.upload", { paper: "id", via: "whatsapp" })).toBe("الهوية الوطنية، من واتساب");
    // A file waiting to be put under its paper already says where it came from.
    expect(auditDetail("doc.upload", { paper: "inbox", via: "whatsapp" })).toBe("وصل في واتساب");
    expect(auditDetail("doc.review", { paper: "deed", verdict: "verified" })).toBe("صك العقار، سليم");
    expect(auditDetail("doc.review", { paper: "deed", verdict: "rejected" })).toBe("صك العقار، يُعاد");
    expect(auditDetail("doc.move", { from: "inbox", to: "deed" })).toBe("إلى صك العقار");
    for (const code of PAPER_CODES) expect(auditDetail("doc.open", { paper: code }), code).toMatch(/^[\u0600-\u06ff]/);
    expect(auditDetail("doc.open", { paper: "custom:7" })).toBe("مستند أضفناه");
    expect(auditDetail("doc.open", { paper: "no_such_paper" })).toBe("");
    expect(auditDetail("doc.open", {})).toBe("");
  });

  it("says what kind of message went out, and counts with Arabic agreement", () => {
    expect(auditDetail("wa.send", { kind: "papers" })).toBe("طلب المستندات");
    expect(auditDetail("wa.send", { kind: "reply", via: "manual" })).toBe("رد بكلماتك، من الجوال");
    expect(auditDetail("wa.send", { kind: "progress", ok: false })).toBe("أين وصل الملف، لم تُرسل");
    expect(auditDetail("wa.handled", { messages: 1 })).toBe("رسالة واحدة");
    expect(auditDetail("wa.handled", { messages: 3 })).toBe("3 رسائل");
    expect(auditDetail("link.open", { days: 14 })).toBe("صالح 14 يوماً");
    expect(auditDetail("link.close", { links: 2 })).toBe("رابطان");
    expect(auditDetail("lender.product_update", { changed: ["rate", "minSalary"], unconfirmed: [] })).toBe("شرطان");
    expect(auditDetail("lender.product_update", { changed: ["rate", "minSalary", "name"], unconfirmed: ["salary", "rate"] })).toBe("3 شروط، سقط تأكيد شرطان");
    // What an older build wrote beside the event confirms nothing.
    expect(auditDetail("lender.product_update", { changed: ["rate"], verified: true })).toBe("شرط واحد");
    expect(eventsCount(1)).toBe("حدث واحد");
    expect(eventsCount(2)).toBe("حدثان");
    expect(eventsCount(7)).toBe("7 أحداث");
    expect(eventsCount(60)).toBe("60 حدثاً");
  });

  it("says what was written down about a lender and what a lender decided", () => {
    expect(auditDetail("lender.rule_add", { title: "تطلب فحصاً طبياً", kind: "condition", lender: "بنك الرياض" })).toBe("اشتراط، بنك الرياض، تطلب فحصاً طبياً");
    // A note that names no lender holds for all of them.
    expect(auditDetail("lender.rule_add", { title: "كثرة الاستعلامات تضر", kind: "tip", lender: null })).toBe("طريقة، كل الجهات، كثرة الاستعلامات تضر");
    expect(auditDetail("lender.rule_add", { title: "ملاحظة", kind: "something" })).toBe("كل الجهات، ملاحظة");
    expect(auditDetail("lender.rule_archive", { title: "تطلب فحصاً طبياً" })).toBe("تطلب فحصاً طبياً");
    expect(auditDetail("lender.rule_archive", {})).toBe("");
    expect(auditDetail("lender.decision", { lender: "بنك الرياض", part: "mortgage", decision: "approved", onDeal: true })).toBe("موافقة، بنك الرياض، العقاري، حُسبت الصفقة عليه");
    expect(auditDetail("lender.decision", { lender: "بنك الرياض", part: "personal", decision: "rejected", onDeal: false })).toBe("رفض، بنك الرياض، الشخصي");
    expect(auditDetail("lender.decision", { lender: "بنك الرياض", part: "boat", decision: "maybe" })).toBe("بنك الرياض");
  });

  it("says which lender or product joined the catalogue, and which product stopped or came back", () => {
    expect(auditAction("lender.add")).toBe("إضافة جهة");
    expect(auditAction("lender.product_add")).toBe("إضافة منتج");
    expect(auditAction("lender.product_update")).toBe("تعديل منتج");
    expect(auditAction("lender.product_switch")).toBe("إيقاف منتج أو إعادته");
    expect(auditDetail("lender.add", { name: "بنك الخليج", type: "bank" })).toBe("بنك، بنك الخليج");
    expect(auditDetail("lender.add", { name: "شركة اليسر", type: "finance_company" })).toBe("شركة تمويل، شركة اليسر");
    expect(auditDetail("lender.add", { name: "بنك الخليج", type: "something" })).toBe("بنك الخليج");
    expect(auditDetail("lender.product_add", { lender: "بنك الخليج", financeType: "mortgage" })).toBe(`بنك الخليج، ${FINANCE_TYPE.mortgage}`);
    expect(auditDetail("lender.product_add", { lender: "بنك الخليج", financeType: "personal", verified: true })).toBe(`بنك الخليج، ${FINANCE_TYPE.personal}`);
    expect(auditAction("lender.terms_confirm")).toBe("تأكيد شروط منتج");
    expect(auditAction("lender.terms_withdraw")).toBe("سحب تأكيد شرط");
    expect(strip(auditDetail("lender.terms_confirm", { lender: "بنك الخليج", product: "التمويل الشخصي", terms: ["salary", "age", "rate"], kind: "lender_document", reference: "تعرفة الأفراد", confirmedOn: "2026-11-20", validUntil: "2027-02-20" }))).toBe(
      "بنك الخليج، التمويل الشخصي، 3 شروط، مستند من الجهة، حتى 20 فبراير 2027",
    );
    expect(auditDetail("lender.terms_confirm", { lender: "بنك الخليج", terms: ["rate"], kind: "hearsay" })).toBe("بنك الخليج، شرط واحد");
    expect(auditDetail("lender.terms_confirm", {})).toBe("");
    expect(auditDetail("lender.terms_withdraw", { lender: "بنك الخليج", product: "التمويل الشخصي", terms: ["rate", "amount"] })).toBe("بنك الخليج، التمويل الشخصي، شرطان");
    expect(auditDetail("lender.product_add", { lender: "بنك الخليج", financeType: "boat" })).toBe("بنك الخليج");
    expect(auditDetail("lender.product_switch", { active: false, lender: "بنك الخليج" })).toBe("أُوقف، بنك الخليج");
    expect(auditDetail("lender.product_switch", { active: true, lender: "بنك الخليج" })).toBe("عاد يعمل، بنك الخليج");
    expect(auditDetail("lender.product_switch", { lender: "بنك الخليج" })).toBe("بنك الخليج");
    expect(auditDetail("lender.product_switch", {})).toBe("");
  });

  it("reads whatever the log holds without breaking or showing a code", () => {
    const strange: (Record<string, unknown> | null | undefined)[] = [
      null,
      undefined,
      {},
      { method: 5, changed: "phone", role: "boss", paper: 12, to: { a: 1 }, kind: [], reason: 7, messages: "3", days: Number.NaN, links: null, passkeys: -1, mortgage: "x", personal: [1], verdict: {}, via: 9, email: "", adopted: "2" },
      { changed: [1, null, "phone"], role: { from: "admin" }, paper: "", to: "", method: "telepathy", verdict: "burnt" },
    ];
    for (const action of [...AUDIT_ACTIONS, "something.new"]) {
      for (const details of strange) {
        const text = auditDetail(action, details);
        expect(text, action).not.toMatch(broken);
        expect(text, action).not.toMatch(/[a-z_]{4,}/);
      }
    }
  });

  it("never repeats a phone or a password the log was handed by mistake", () => {
    const leak = { phone: "966500000101", password: "correct horse battery", changed: ["phone"], nationalId: "1012345674", token: "abc123abc123" };
    for (const action of AUDIT_ACTIONS) {
      const text = auditDetail(action, leak);
      expect(text, action).not.toMatch(/\d{6,}/);
      expect(text, action).not.toContain("horse");
      expect(text, action).not.toContain("abc123");
    }
  });
});
