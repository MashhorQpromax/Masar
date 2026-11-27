import Link from "next/link";

export function LenderTabs({ at }: { at: "products" | "knowledge" }) {
  return (
    <div className="seg">
      <Link href="/lenders" className={`seg-item ${at === "products" ? "seg-on" : ""}`}>المنتجات</Link>
      <Link href="/knowledge" className={`seg-item ${at === "knowledge" ? "seg-on" : ""}`}>الخبرة</Link>
    </div>
  );
}
