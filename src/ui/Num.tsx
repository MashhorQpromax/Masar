import { plainMoney } from "@/copy/format";

/** A standalone figure: whole riyals, aligned digits, always left to right. */
export function Num({ value, className }: { value: number; className?: string }) {
  return <span className={className ? `num ${className}` : "num"}>{plainMoney(value)}</span>;
}
