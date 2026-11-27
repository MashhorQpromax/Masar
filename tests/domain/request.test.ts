import { describe, expect, it } from "vitest";
import { answered, approveRefusal, consentFor, contactProblem, contactState, daysBetween, followUpDue, isOpen, partsOf, prepareRefusal, sendRefusal, type ShareConsent } from "@/domain/request";

const today = "2026-11-23";

describe("a way of reaching a lender", () => {
  it("carries a request only with a source and a check that still holds", () => {
    expect(contactState({ source: "خطاب الجهة", checkedOn: "2026-11-01", active: true }, today)).toEqual({ usable: true, problem: null, until: "2027-05-01" });
    expect(contactState({ source: null, checkedOn: "2026-11-01", active: true }, today).problem).toBe("NO_SOURCE");
    expect(contactState({ source: "موقع الجهة", checkedOn: null, active: true }, today)).toEqual({ usable: false, problem: "UNCHECKED", until: null });
    // Six months to the day still holds; the day after does not.
    expect(contactState({ source: "بطاقة الموظف", checkedOn: "2026-05-23", active: true }, today).usable).toBe(true);
    expect(contactState({ source: "بطاقة الموظف", checkedOn: "2026-05-22", active: true }, today).problem).toBe("EXPIRED");
    expect(contactState({ source: "خطاب الجهة", checkedOn: "2026-11-01", active: false }, today).problem).toBe("STOPPED");
  });

  it("is written the way its kind is written", () => {
    expect(contactProblem("email", "sme@bank.example")).toBeNull();
    expect(contactProblem("email", "bank.example")).toBe("EMAIL");
    expect(contactProblem("whatsapp", "+966 55 123 4567")).toBeNull();
    expect(contactProblem("phone", "اتصل بالفرع")).toBe("PHONE");
    expect(contactProblem("portal", "https://portal.bank.example/sme")).toBeNull();
    expect(contactProblem("portal", "http://portal.bank.example")).toBe("LINK");
    expect(contactProblem("visit", "فرع العليا، الدور الثاني")).toBeNull();
  });
});

describe("the client's consent to sharing with a lender", () => {
  const consent = (id: number, lenderId: number, withdrawn = false): ShareConsent => ({
    id,
    lenderId,
    way: "written",
    note: null,
    givenOn: "2026-11-20",
    withdrawn,
  });
  it("stands for one lender until it is withdrawn, and the newest counts", () => {
    expect(consentFor([consent(3, 7), consent(2, 9)], 9)?.id).toBe(2);
    expect(consentFor([consent(3, 7, true)], 7)).toBeNull();
    expect(consentFor([consent(4, 7), consent(3, 7, true)], 7)?.id).toBe(4);
    expect(consentFor([], 7)).toBeNull();
  });
});

describe("preparing a request", () => {
  const ok = {
    ended: false,
    consented: true,
    sharing: true,
    approved: true,
    viable: true,
    open: false,
  };
  it("is refused for the first thing missing, in the order a person fixes them", () => {
    expect(prepareRefusal(ok)).toBeNull();
    expect(prepareRefusal({ ...ok, ended: true, consented: false })).toBe("DEAL_ENDED");
    expect(prepareRefusal({ ...ok, consented: false, sharing: false })).toBe("NO_CONSENT");
    expect(prepareRefusal({ ...ok, sharing: false, approved: false })).toBe("NO_SHARING");
    expect(prepareRefusal({ ...ok, approved: false, viable: false })).toBe("NOT_APPROVED");
    expect(prepareRefusal({ ...ok, viable: false, open: true })).toBe("NOT_VIABLE");
    expect(prepareRefusal({ ...ok, open: true })).toBe("OPEN_REQUEST");
  });
});

describe("approving and sending a request", () => {
  it("approves only a prepared request whose message still says what the file says", () => {
    const ok = {
      status: "draft" as const,
      sharing: true,
      approved: true,
      viable: true,
      stale: false,
    };
    expect(approveRefusal(ok)).toBeNull();
    expect(approveRefusal({ ...ok, status: "approved" })).toBe("STATUS");
    expect(approveRefusal({ ...ok, sharing: false })).toBe("NO_SHARING");
    expect(approveRefusal({ ...ok, approved: false })).toBe("NOT_APPROVED");
    expect(approveRefusal({ ...ok, viable: false })).toBe("NOT_VIABLE");
    expect(approveRefusal({ ...ok, stale: true })).toBe("STALE");
  });

  it("records a send only for an approved request, through the lender's own checked way, on a day that came", () => {
    const usable = contactState({ source: "خطاب الجهة", checkedOn: "2026-11-01", active: true }, today);
    const ok = {
      status: "approved" as const,
      sharing: true,
      contact: usable,
      sameLender: true,
      sentOn: today,
      approvedOn: "2026-11-22",
      today,
    };
    expect(sendRefusal(ok)).toBeNull();
    expect(sendRefusal({ ...ok, status: "draft" })).toBe("STATUS");
    expect(sendRefusal({ ...ok, sharing: false })).toBe("NO_SHARING");
    expect(
      sendRefusal({
        ...ok,
        contact: contactState({ source: null, checkedOn: null, active: true }, today),
      }),
    ).toBe("CONTACT");
    expect(sendRefusal({ ...ok, contact: null })).toBe("CONTACT");
    expect(sendRefusal({ ...ok, sameLender: false })).toBe("CONTACT");
    expect(sendRefusal({ ...ok, sentOn: "2026-11-24" })).toBe("DAY");
    expect(sendRefusal({ ...ok, sentOn: "2026-11-21" })).toBe("DAY");
  });
});

describe("a request's answer and its follow-up", () => {
  it("is answered once every part it asked about has an answer", () => {
    const both = partsOf({ mortgageProductId: 4, personalProductId: 9 });
    expect(both).toEqual(["mortgage", "personal"]);
    expect(partsOf({ mortgageProductId: null, personalProductId: 9 })).toEqual(["personal"]);
    expect(answered(both, ["personal"])).toBe(false);
    expect(answered(both, ["personal", "mortgage"])).toBe(true);
    expect(answered([], [])).toBe(false);
    expect(isOpen("sent")).toBe(true);
    expect(isOpen("answered")).toBe(false);
  });

  it("is due a follow-up once it waited the office's days without an answer", () => {
    expect(daysBetween("2026-11-16", today)).toBe(7);
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(followUpDue({ status: "sent", sentOn: "2026-11-16" }, today, 7)).toBe(true);
    expect(followUpDue({ status: "sent", sentOn: "2026-11-17" }, today, 7)).toBe(false);
    expect(followUpDue({ status: "answered", sentOn: "2026-11-01" }, today, 7)).toBe(false);
    expect(followUpDue({ status: "approved", sentOn: null }, today, 7)).toBe(false);
  });
});
