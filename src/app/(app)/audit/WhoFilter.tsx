"use client";

import { useRouter } from "next/navigation";

/** Chooses whose events to read. The choice is an address, so it can be kept or sent to someone. */
export function WhoFilter({ people, chosen, hrefs }: { people: { id: number; name: string }[]; chosen: number | null; hrefs: Record<string, string> }) {
  const router = useRouter();
  return (
    <select className="filter filter--who" aria-label="من قام بالحدث" value={chosen ?? ""} onChange={(event) => router.push(hrefs[event.target.value] ?? hrefs[""]!)}>
      <option value="">كل الأشخاص</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name}
        </option>
      ))}
    </select>
  );
}
