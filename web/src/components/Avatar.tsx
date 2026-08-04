/**
 * Round avatar with an initials fallback.
 *
 * Mobile never made this a component — it is inline styles in PostCard plus a separate
 * initials fallback, reimplemented per screen. Web makes it a component on the first use
 * rather than the eighteenth.
 *
 * The fallback is a solid purple disc, which is one of the documented exceptions to
 * "purple never fills": decorative avatar fallbacks stay solid, because an outlined initial
 * on a dark background is unreadable.
 */
export function Avatar({
  url,
  name,
  size = 36,
}: {
  url: string | null;
  name: string | null;
  size?: number;
}) {
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '♪';

  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" /> : <span className="avatar__initial">{initial}</span>}
    </span>
  );
}
