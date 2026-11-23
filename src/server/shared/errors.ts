/** An expected failure with a stable code the interface can translate. */
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "INVALID_STAGE"
      | "DEAL_ALREADY_OPEN"
      | "DEAL_ENDED"
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
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}
