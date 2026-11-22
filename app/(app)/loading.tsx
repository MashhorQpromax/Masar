export default function Loading() {
  return (
    <div aria-busy="true" aria-label="جارٍ التحميل">
      <div className="skeleton h-8 w-56 mb-3" />
      <div className="skeleton h-4 w-72 mb-8" />
      <div className="skeleton h-28 w-full mb-6 !rounded-2xl" />
      <div className="grid lg:grid-cols-2 gap-4"><div className="skeleton h-64 !rounded-2xl" /><div className="skeleton h-64 !rounded-2xl" /></div>
    </div>
  );
}
