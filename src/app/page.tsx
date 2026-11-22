/** Placeholder until the first screens land. Shows the new identity only, no data. */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-6 px-4 text-center">
      <svg viewBox="0 0 320 120" className="w-72" fill="none" aria-hidden="true">
        <path d="M304 84C258 84 244 36 198 36S138 84 92 84" stroke="#0f2a43" strokeWidth="18" strokeLinecap="round" />
        <path d="M304 84C258 84 244 36 198 36S138 84 92 84" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeDasharray="7 11" />
        <circle cx="62" cy="84" r="22" fill="#ffc233" stroke="#0f2a43" strokeWidth="5" />
      </svg>
      <h1 className="text-5xl font-bold">مسار</h1>
      <p className="text-lg text-body">النسخة الجديدة قيد البناء.</p>
    </main>
  );
}
