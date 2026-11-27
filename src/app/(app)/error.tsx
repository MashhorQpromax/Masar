"use client";

/** Shown when a page fails. Says so plainly and offers to try again. */
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="empty mt-8">
      <h1 className="text-3xl font-bold">تعذّر فتح الصفحة</h1>
      <p className="text-body">لم يتغير شيء في البيانات. جرّب مرة أخرى.</p>
      <button type="button" className="btn btn--navy mt-2" onClick={reset}>
        أعد المحاولة
      </button>
    </div>
  );
}
