import Link from "next/link";

const PLACES = [
  { href: "/lenders", label: "الشروط" },
  { href: "/lenders/calculator", label: "الحاسبة" },
  { href: "/lenders/knowledge", label: "الخبرة" },
  { href: "/lenders/requests", label: "الطلبات" },
  { href: "/lenders/contacts", label: "التواصل" },
];

/** The pages that live under the lenders: their terms, what those terms give a client, what the office learned, what it asked them, and how it reaches them. */
export function LendersNav({ current }: { current: string }) {
  return (
    <nav className="filters" aria-label="صفحات الجهات">
      {PLACES.map((place) => (
        <Link key={place.href} className="filter" href={place.href} aria-current={place.href === current ? "true" : undefined}>
          {place.label}
        </Link>
      ))}
    </nav>
  );
}
