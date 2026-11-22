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
