import type { DocumentNeed, FinanceType, Nationality, Sector } from "./types";

const need = (code: string, category: DocumentNeed["category"], required = true): DocumentNeed => ({ code, category, required });

/**
 * The papers a lender asks for, by the kind of finance and who the client is.
 * Each paper is listed once: when two rules ask for the same one, the first stands.
 */
export function requiredDocuments(financeType: FinanceType, sector: Sector, _nationality: Nationality): DocumentNeed[] {
  const needs: DocumentNeed[] = [
    need("id", "identity"),
    need("address", "identity"),
    need("simah", "obligations"),
    need("obligations", "obligations", false),
  ];

  if (sector === "self") {
    needs.push(need("cr", "business"), need("fin_statements", "business"), need("zakat", "business"), need("bank_12", "income"));
  } else if (sector === "retired") {
    needs.push(need("pension", "income"), need("bank_3", "income"));
  } else {
    needs.push(need("salary_cert", "income"), need("bank_3", "income"));
    if (sector === "private" || sector === "private_approved") needs.push(need("gosi", "income"));
    else needs.push(need("payslip", "income", false));
  }

  if (financeType === "mortgage") {
    needs.push(need("deed", "collateral"), need("valuation", "collateral"), need("family", "identity", false), need("sakani", "income", false));
  }
  if (financeType === "project") {
    needs.push(
      need("deed", "collateral"),
      need("valuation", "collateral"),
      need("feasibility", "business"),
      need("permit", "collateral"),
      need("boq", "business"),
      need("sources_uses", "business"),
      need("bank_12", "income"),
      need("cr", "business", false),
      need("lien", "collateral", false),
      need("zoning", "collateral", false),
    );
  }
  if (financeType === "auto") needs.push(need("quote", "collateral"), need("license", "identity"));
  if (financeType === "sme" && sector !== "self") needs.push(need("cr", "business"), need("fin_statements", "business"));

  const seen = new Set<string>();
  return needs.filter((n) => !seen.has(n.code) && seen.add(n.code));
}
