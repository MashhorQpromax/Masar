/** Shown while a page reads its data: the road drawing itself. */
export default function Loading() {
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status" aria-label="جارٍ التحميل">
      <svg viewBox="0 0 320 120" className="w-64" fill="none" aria-hidden="true">
        <path className="road-line" pathLength={1} d="M304 84C258 84 244 36 198 36S138 84 92 84" stroke="#0f2a43" strokeWidth="18" strokeLinecap="round" />
        <path className="road-dash" d="M304 84C258 84 244 36 198 36S138 84 92 84" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <circle className="road-ring" cx="62" cy="84" r="20" stroke="#ffc233" strokeWidth="2" />
        <circle cx="62" cy="84" r="20" fill="#ffc233" stroke="#0f2a43" strokeWidth="5" />
      </svg>
    </div>
  );
}
