import { CERTAINTY } from "@/copy/net";
import type { Certainty } from "@/domain/deal";
import { CheckIcon } from "./icons";

/** Beside a figure: whether a written word stands behind it, or the engine counted it. */
export function Certain({ value }: { value: Certainty }) {
  return (
    <span className="certain" data-certainty={value}>
      {value === "confirmed" && <CheckIcon size={12} />}
      {CERTAINTY[value]}
    </span>
  );
}
