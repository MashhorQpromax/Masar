import "server-only";
import { createHash } from "node:crypto";
import { canonical } from "@/domain/analysis";

/** The print of a value: equal values, equal prints, whatever order their keys were written in. */
export const printOf = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex").slice(0, 32);
