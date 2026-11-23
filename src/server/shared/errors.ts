/** An expected failure with a stable code the interface can translate. */
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "INVALID_STAGE"
      | "DEAL_ALREADY_OPEN"
      | "DEAL_ENDED"
      | "NOT_A_PROJECT"
      | "LENDER_KNOWN"
      | "OFFER_RECORDED"
      | "ROUTE_GONE"
      | "ROUTE_REFUSED"
      | "FILE_TYPE"
      | "FILE_TOO_LARGE"
      | "FILE_LIMIT"
      | "PAPER_EMPTY"
      | "PAPER_HAS_FILES"
      | "UPLOAD_LIMIT"
      | "LINK_CLOSED"
      | "GATE_CLOSED"
      | "WA_OFF"
      | "NO_PHONE"
      | "MESSAGE_EMPTY"
      | "SEND_FAILED"
      | "BAD_PHONE"
      | "BAD_EMAIL"
      | "ID_FORMAT"
      | "ID_KIND"
      | "ID_CHECK"
      | "PHONE_TAKEN"
      | "ID_TAKEN"
      | "NOTE_EMPTY"
      | "CONSENT_NEEDED"
      | "NUMBER_KNOWN"
      | "OWN_ACCOUNT"
      | "FORBIDDEN"
      | "EMAIL_TAKEN"
      | "WRONG_PASSWORD"
      | "PASSWORD_SHORT"
      | "PASSWORD_LONG"
      | "LOCKED"
      | "BAD_CODE"
      | "STEP_EXPIRED"
      | "CONFIRM_FIRST"
      | "AUTHENTICATOR_ON"
      | "PASSKEY_REFUSED"
      | "PASSKEY_KNOWN",
    message?: string,
    /** What the wording needs beyond the code, such as the file number a phone already belongs to. */
    public readonly params: Record<string, string> = {},
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}
