/** The four roles of the office, from the widest reach to the narrowest. */
export const ROLES = ["admin", "analyst", "officer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * What each role may do. Everyone who is signed in may read; a permission is asked only where
 * something changes or something private is shown. A viewer holds none of them.
 */
const PERMISSIONS = {
  "client.create": ["admin", "analyst", "officer"],
  "client.edit": ["admin", "analyst", "officer"],
  "client.delete": ["admin"],
  "client.view_pii": ["admin", "analyst", "officer"],
  "deal.edit": ["admin", "analyst", "officer"],
  /** Approving a client's analysis: the office's recommendation, signed. Until the owner says otherwise, the manager's alone. */
  "study.approve": ["admin"],
  "doc.upload": ["admin", "analyst", "officer"],
  "doc.verify": ["admin", "analyst"],
  "app.manage": ["admin", "analyst", "officer"],
  "lender.manage": ["admin", "analyst"],
  /** Saying that a lender's term was checked against its source. The result of every study rests on it. */
  "lender.confirm": ["admin"],
  "user.manage": ["admin"],
  "audit.view": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Why a sign-in was refused. One answer covers a wrong password, an unknown email and a stopped account. */
export type SignInRefusal = "BAD_CREDENTIALS" | "BAD_CODE" | "BAD_PASSKEY" | "LOCKED" | "TOO_MANY" | "STEP_EXPIRED";

/** New passwords: at least this many characters. Passwords set before the rebuild keep working. */
export const PASSWORD_MIN = 10;
/** bcrypt reads the first 72 bytes only. A longer password is refused instead of silently cut. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "PASSWORD_SHORT" | "PASSWORD_LONG";

export function passwordProblem(password: string): PasswordProblem | null {
  if ([...password].length < PASSWORD_MIN) return "PASSWORD_SHORT";
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "PASSWORD_LONG";
  return null;
}
