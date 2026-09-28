/**
 * The mark: a solid disc (the Floor) overlapped by an open ring (the Upside). The ring is drawn
 * twice, first in the ground colour to cut it out of the disc, then in ochre, so the two forms
 * stay one object at any size. The ring's opening never closes.
 */
export function Mark({size = 36, ground = "var(--bg)", colour = "var(--accent)", label}: {
  size?: number; ground?: string; colour?: string; label?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role={label ? "img" : undefined}
         aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="15" cy="22" r="10" fill={colour} />
      <path d="M32.28 23.11 A9.5 9.5 0 1 1 33.93 13.75" fill="none" stroke={ground} strokeWidth="7" />
      <path d="M32.28 23.11 A9.5 9.5 0 1 1 33.93 13.75" fill="none" stroke={colour} strokeWidth="3" />
    </svg>
  );
}
