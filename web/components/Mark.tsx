export function Mark({size = 30}: {size?: number}) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="41.2" cy="78.8" r="28" fill="#D9924A" />
      <circle cx="79" cy="41" r="26" fill="none" stroke="#D9924A" strokeWidth="11" />
    </svg>
  );
}
