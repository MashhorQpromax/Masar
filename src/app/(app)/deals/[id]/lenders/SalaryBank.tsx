"use client";

import { useState, useTransition } from "react";
import { saveSalaryBank } from "./actions";

/** Where the client's salary is paid. Changing it saves at once and the lenders are worked out again. */
export function SalaryBank({ dealId, clientId, value, banks }: { dealId: number; clientId: number; value: string | null; banks: { code: string; name: string }[] }) {
  const [chosen, setChosen] = useState(value ?? "");
  const [pending, start] = useTransition();
  return (
    <label className="pick" data-busy={pending || undefined}>
      <span>الراتب على</span>
      <select
        value={chosen}
        disabled={pending}
        onChange={(event) => {
          const bankCode = event.target.value;
          setChosen(bankCode);
          start(() => saveSalaryBank({ dealId, clientId, bankCode: bankCode || null }));
        }}
      >
        <option value="">غير محدد</option>
        {banks.map((bank) => (
          <option key={bank.code} value={bank.code}>
            {bank.name}
          </option>
        ))}
      </select>
    </label>
  );
}
