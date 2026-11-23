"use client";

import { useActionState } from "react";
import { planError } from "@/copy/fees";
import { SubmitButton } from "@/ui/SubmitButton";
import { approvePlan, type PlanAnswer } from "./actions";

/** Approving the deal's fee plan as the numbers stand: one press, and a refusal said in words. */
export function ApprovePlan({ dealId }: { dealId: number }) {
  const [answer, send] = useActionState<PlanAnswer, FormData>(approvePlan.bind(null, dealId), {});
  return (
    <form className="approve" action={send}>
      <SubmitButton className="btn btn--navy">اعتمد خطة الأتعاب</SubmitButton>
      {answer.error && (
        <p key={answer.error} role="alert" className="said" data-bad>
          {planError(answer.error, answer.params)}
        </p>
      )}
    </form>
  );
}
