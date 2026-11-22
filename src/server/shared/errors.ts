/** An expected failure with a stable code the interface can translate. */
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "INVALID_STAGE"
      | "DEAL_ALREADY_OPEN"
      | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "DomainError";
  }
}
