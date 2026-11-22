/** How the employer is classified. It decides retirement and which lenders accept the client. */
export const SECTORS = ["gov", "semi_gov", "military", "private_approved", "private", "retired", "self"] as const;
export type Sector = (typeof SECTORS)[number];
