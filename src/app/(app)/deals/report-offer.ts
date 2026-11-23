import { draftLabel } from "@/copy/credit";
import type { CreditReport } from "@/domain/credit";
import { reportDrafts } from "@/domain/deal";
import type { ReportOffer } from "./DealEditor";

/**
 * What a client's stored credit report offers the deal editor: each commitment the report shows,
 * worded as the deal stores it. The editor puts nothing in the deal on its own account: a person
 * reviews every item, and it is kept only when they save.
 */
export function reportOffer(report: CreditReport): ReportOffer {
  return { day: report.reportDate ?? null, drafts: reportDrafts(report).map((draft) => ({ ...draft, label: draftLabel(draft.source) })) };
}
