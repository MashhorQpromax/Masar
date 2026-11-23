/**
 * Every kind of event the audit log holds, grouped by the part of the office it belongs to.
 * A new event is added here first: a test fails when the server writes one this list does not know.
 */
export const AUDIT_AREAS = {
  signin: ["login", "login_failed", "logout", "login_code_sent"],
  users: [
    "user.create",
    "user.update",
    "user.password_reset",
    "user.signin_reset",
    "user.unlock",
    "user.confirm",
    "user.password",
    "user.authenticator_on",
    "user.authenticator_off",
    "user.passkey_add",
    "user.passkey_remove",
    "user.sessions_end",
  ],
  clients: ["client.create", "client.update", "client.contact", "client.note", "client.consent", "client.condition_answer", "client.fact_rely", "study.approve", "client.reject", "client.reopen", "credit.report_add", "credit.report_review", "project.save"],
  deals: ["deal.save", "deal.fee", "deal.fee_approve", "deal.stage", "deal.route", "settings.fees"],
  papers: ["doc.upload", "doc.remove", "doc.move", "doc.review", "doc.state", "doc.add", "doc.drop", "doc.open"],
  messages: ["wa.send", "wa.handled", "link.open", "link.close"],
  lenders: ["lender.add", "lender.product_add", "lender.product_update", "lender.product_switch", "lender.terms_confirm", "lender.terms_withdraw", "lender.condition_add", "lender.condition_remove", "lender.rule_add", "lender.rule_archive", "lender.decision"],
} as const;

/**
 * Events the old system wrote and this build has no like of. They come over with the old log so its
 * history stays readable. The last one is written once, by the move itself.
 */
export const OLD_AUDIT_ACTIONS = [
  "old.status",
  "old.view",
  "old.delete",
  "old.export",
  "old.study",
  "old.obligation_add",
  "old.obligation_remove",
  "old.application_add",
  "old.application_update",
  "old.other",
  "old.moved",
] as const;
export type OldAuditAction = (typeof OLD_AUDIT_ACTIONS)[number];

export type AuditArea = keyof typeof AUDIT_AREAS;
export type AuditAction = (typeof AUDIT_AREAS)[AuditArea][number];

export const AUDIT_AREA_NAMES = Object.keys(AUDIT_AREAS) as AuditArea[];
export const AUDIT_ACTIONS: readonly AuditAction[] = Object.values(AUDIT_AREAS).flat();

export const isAuditArea = (value: unknown): value is AuditArea => typeof value === "string" && (AUDIT_AREA_NAMES as readonly string[]).includes(value);

/** The part of the office an event belongs to. Null for an event this build does not know. */
export function areaOf(action: string): AuditArea | null {
  return AUDIT_AREA_NAMES.find((area) => (AUDIT_AREAS[area] as readonly string[]).includes(action)) ?? null;
}

/**
 * Events worth a second look: a way in that failed, a private file that was opened, and every change
 * to who may enter and what they may do.
 */
export const WATCHED_ACTIONS: readonly AuditAction[] = ["login_failed", "doc.open", "user.create", "user.update", "user.password_reset", "user.signin_reset", "user.unlock", "settings.fees"];

export const isWatched = (action: string): boolean => (WATCHED_ACTIONS as readonly string[]).includes(action);
