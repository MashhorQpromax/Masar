import Link from "next/link";
export default function NotFound() {
  return <div className="min-h-[60vh] grid place-items-center text-center"><div><div className="text-5xl font-bold text-brand-700">404</div><p className="mt-2 text-slate-500">الصفحة غير موجودة</p><Link href="/" className="btn-primary mt-6">الرئيسية</Link></div></div>;
}
