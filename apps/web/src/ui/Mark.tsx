/** The product's mark: a ruled page with its margin, drawn in ink. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 3v18" />
      <path d="M11 9h6M11 13h6M11 17h4" />
    </svg>
  );
}
