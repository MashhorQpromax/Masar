"use client";
import { Icon } from "@/components/icon";
export default function PrintButton() {
  return <button onClick={() => window.print()} className="btn-primary"><Icon name="print" className="size-4" />طباعة أو حفظ PDF</button>;
}
