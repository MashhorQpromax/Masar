"use client";

import { useActionState } from "react";
import { reportError } from "@/copy/opportunity";
import { SubmitButton } from "@/ui/SubmitButton";
import { saveReport, type ReportAnswer } from "./actions";

/** Saving the study as it stands: one press, and a refusal said in words. */
export function SaveReport({ dealId }: { dealId: number }) {
  const [answer, send] = useActionState<ReportAnswer, FormData>(saveReport.bind(null, dealId), {});
  return (
    <form className="approve" action={send}>
      <SubmitButton className="btn btn--navy">احفظ التقرير</SubmitButton>
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {reportError(answer.error, answer.params)}
        </p>
      )}
    </form>
  );
}
