/**
 * A deal's requests to lenders: the ways of reaching a lender and whether one can be used, the client's
 * consent to sharing with a lender, what a request tells the lender, and the road a request travels
 * from prepared to answered. Pure: the server reads and writes, this decides.
 *
 * Nothing here sends anything. A person sends the message through a way the office checked, and
 * records that they did.
 */
import type { ContractType, Nationality, Sector } from "../eligibility";
import { addMonths } from "../eligibility";
import type { Part } from "../opportunity";

export const CONTACT_KINDS = ["email", "whatsapp", "phone", "portal", "visit"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** Months a check of a way of reaching a lender holds. After that someone confirms it again. */
export const CONTACT_VALIDITY_MONTHS = 6;

export interface Contact {
  id: number;
  lenderId: number;
  kind: ContactKind;
  value: string;
  person: string | null;
  source: string | null;
  /** The day someone checked it reaches the lender. */
  checkedOn: string | null;
  active: boolean;
}

export type ContactProblem = "STOPPED" | "NO_SOURCE" | "UNCHECKED" | "EXPIRED";

export interface ContactState {
  usable: boolean;
  problem: ContactProblem | null;
  /** The last day the check holds. Null when it was never checked. */
  until: string | null;
}

/** Whether a way of reaching a lender can carry a request today. One without a source never can. */
export function contactState(contact: Pick<Contact, "source" | "checkedOn" | "active">, today: string): ContactState {
  const until = contact.checkedOn ? addMonths(contact.checkedOn, CONTACT_VALIDITY_MONTHS) : null;
  const problem: ContactProblem | null = !contact.active ? "STOPPED" : !contact.source ? "NO_SOURCE" : !until ? "UNCHECKED" : today > until ? "EXPIRED" : null;
  return { usable: problem == null, problem, until };
}

/** What a written way must look like before it is kept. */
export function contactProblem(kind: ContactKind, value: string): "EMAIL" | "PHONE" | "LINK" | null {
  const v = value.trim();
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "EMAIL";
  if (kind === "whatsapp" || kind === "phone") return /^\+?[\d\s-]{7,20}$/.test(v) ? null : "PHONE";
  if (kind === "portal") return /^https:\/\/\S+$/i.test(v) ? null : "LINK";
  return null;
}

export const CONSENT_WAYS = ["written", "verbal"] as const;
export type ConsentWay = (typeof CONSENT_WAYS)[number];

export interface ShareConsent {
  id: number;
  lenderId: number;
  way: ConsentWay;
  note: string | null;
  givenOn: string;
  withdrawn: boolean;
}

/** The consent that stands for one lender: the newest not withdrawn. */
export function consentFor(consents: readonly ShareConsent[], lenderId: number): ShareConsent | null {
  return consents.find((c) => c.lenderId === lenderId && !c.withdrawn) ?? null;
}

/** One part a request asks the lender about. */
export interface SharedLeg {
  part: Part;
  product: string;
  amount: number;
  months: number;
}

/**
 * Everything a request tells the lender, and nothing else. It names no client: no name, no identity
 * number, no phone, no day of birth. The lender answers on a profile, and the office's reference
 * ties the answer back to the file.
 */
export interface SharedFacts {
  ref: string;
  legs: SharedLeg[];
  age: number | null;
  nationality: Nationality;
  sector: Sector;
  contractType: ContractType | null;
  serviceMonths: number | null;
  basicSalary: number | null;
  totalSalary: number | null;
  /** The bank the salary is paid into, by name. */
  salaryBank: string | null;
  /** A checked paper states the income. */
  incomeVerified: boolean;
  /** Monthly installments of the obligations that stay after the deal. */
  keptMonthly: number;
  /** What the lender will read on the credit record once the deal has settled what it settles. */
  record: {
    known: boolean;
    open: boolean;
    settledMonthsAgo: number | null;
    delays: boolean;
  };
}

/** The keys a request may tell a lender. A test holds the shared facts to exactly these. */
export const SHARED_KEYS = [
  "ref",
  "legs",
  "age",
  "nationality",
  "sector",
  "contractType",
  "serviceMonths",
  "basicSalary",
  "totalSalary",
  "salaryBank",
  "incomeVerified",
  "keptMonthly",
  "record",
] as const satisfies readonly (keyof SharedFacts)[];

export const REQUEST_STATUSES = ["draft", "approved", "sent", "answered", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** A request still on its road. One of these at a time for a client and a lender. */
export const OPEN_STATUSES: readonly RequestStatus[] = ["draft", "approved", "sent"];
export const isOpen = (status: RequestStatus): boolean => OPEN_STATUSES.includes(status);

/** Why a request cannot be prepared. */
export type PrepareRefusal =
  /** The deal is closed or lost. */
  | "DEAL_ENDED"
  /** The client's consent to the office processing their data is not recorded. */
  | "NO_CONSENT"
  /** The client did not consent to their data going to this lender. */
  | "NO_SHARING"
  /** No approval of the client's analysis stands: the file the message is built from is not approved as it reads now. */
  | "NOT_APPROVED"
  /** The lender refused, a confirmed condition blocks the client, or the deal leaves a deficit. */
  | "NOT_VIABLE"
  /** A request to this lender for this client is already open. */
  | "OPEN_REQUEST";

export function prepareRefusal(args: { ended: boolean; consented: boolean; sharing: boolean; approved: boolean; viable: boolean; open: boolean }): PrepareRefusal | null {
  if (args.ended) return "DEAL_ENDED";
  if (!args.consented) return "NO_CONSENT";
  if (!args.sharing) return "NO_SHARING";
  if (!args.approved) return "NOT_APPROVED";
  if (!args.viable) return "NOT_VIABLE";
  if (args.open) return "OPEN_REQUEST";
  return null;
}

/** Why a prepared request cannot be approved. */
export type ApproveRefusal = "STATUS" | "NO_SHARING" | "NOT_APPROVED" | "NOT_VIABLE" | "STALE";

/**
 * Approving signs the message as it was prepared. It is refused when the file moved since: what the
 * lender would be told is no longer what the file says, and a new request is prepared instead.
 */
export function approveRefusal(args: { status: RequestStatus; sharing: boolean; approved: boolean; viable: boolean; stale: boolean }): ApproveRefusal | null {
  if (args.status !== "draft") return "STATUS";
  if (!args.sharing) return "NO_SHARING";
  if (!args.approved) return "NOT_APPROVED";
  if (!args.viable) return "NOT_VIABLE";
  if (args.stale) return "STALE";
  return null;
}

export type SendRefusal = "STATUS" | "NO_SHARING" | "CONTACT" | "DAY";

/** Recording that a person sent the message: only an approved one, through a way that can carry it, on a day that has come. */
export function sendRefusal(args: {
  status: RequestStatus;
  sharing: boolean;
  contact: ContactState | null;
  sameLender: boolean;
  sentOn: string;
  approvedOn: string | null;
  today: string;
}): SendRefusal | null {
  if (args.status !== "approved") return "STATUS";
  if (!args.sharing) return "NO_SHARING";
  if (!args.contact?.usable || !args.sameLender) return "CONTACT";
  if (args.sentOn > args.today || (args.approvedOn != null && args.sentOn < args.approvedOn)) return "DAY";
  return null;
}

/** The parts a request asks about, by its products. */
export function partsOf(request: { mortgageProductId: number | null; personalProductId: number | null }): Part[] {
  return [...(request.mortgageProductId != null ? (["mortgage"] as const) : []), ...(request.personalProductId != null ? (["personal"] as const) : [])];
}

/** A request is answered once every part it asked about has the lender's answer recorded on it. */
export function answered(parts: readonly Part[], answers: readonly Part[]): boolean {
  return parts.length > 0 && parts.every((part) => answers.includes(part));
}

/** Days the office waits for a lender's answer before the request shows for a follow-up, unless the manager sets otherwise. */
export const FOLLOW_UP_DAYS = 7;
export const FOLLOW_UP_RANGE = { min: 1, max: 60 } as const;

/** Whole days from one day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A sent request with no answer after the office's wait is due a follow-up. */
export function followUpDue(request: { status: RequestStatus; sentOn: string | null }, today: string, days: number): boolean {
  return request.status === "sent" && request.sentOn != null && daysBetween(request.sentOn, today) >= days;
}
