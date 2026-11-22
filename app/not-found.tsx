import Link from "next/link";
import { Spot } from "@/components/art";

export default function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center text-center p-6">
      <div className="flex flex-col items-center">
        <Spot kind="lost" className="w-52" />
        <div className="figure text-5xl font-bold mt-2">404</div>
        <p className="mt-2 text-slate-500">هذا المسار لا يوصل إلى شيء.</p>
        <Link href="/" className="btn-primary mt-6">العودة للرئيسية</Link>
      </div>
    </div>
  );
}
