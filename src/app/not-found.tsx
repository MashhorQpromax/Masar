import Link from "next/link";
import { Mark } from "@/ui/icons";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
      <div className="grid justify-items-center gap-4">
        <Mark size={56} />
        <h1 className="text-4xl font-bold">هذه الصفحة غير موجودة</h1>
        <Link className="btn btn--navy" href="/">
          إلى الطريق
        </Link>
      </div>
    </main>
  );
}
