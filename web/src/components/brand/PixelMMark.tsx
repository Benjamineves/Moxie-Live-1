/**
 * The canonical Moxie pixel-M mark. Single source of geometry for every
 * rendered instance in the app; the static assets (favicon, PWA icons,
 * apple-touch-icon) are generated from these same coordinates by
 * scripts/generate-pwa-icons.mjs.
 *
 * Default scheme is SPLIT — navy M body, gold corner brackets, aqua
 * signal pixel. Nothing defaults to all-gold or all-navy.
 *
 * INVERTED USE: on a dark surface the navy body disappears, so callers
 * sitting on navy pass markColor="#c9a84c" to render the body in gold.
 * The aqua signal pixel is retained either way — it's the one element
 * that reads on both grounds.
 *
 * The viewBox is fixed at "0 0 100 100" and must stay that way. There is
 * deliberately no preserveAspectRatio override and no independent
 * width/height: the M's center vertex sits at the bottom of the glyph
 * (45,45 relative to columns ending at y=79), so any non-uniform scale
 * or cropped container clips it first. Size the mark through `size` or a
 * uniform CSS box (h-7 w-7); never constrain one axis alone, and never
 * put it in a wrapper with overflow:hidden and a fixed height.
 */
export function PixelMMark({
  markColor = "#0d1f35",
  bracketColor = "#c9a84c",
  aqua = "#17c3b2",
  size = 200,
  className,
}: {
  /** The M body. Pass "#c9a84c" on dark surfaces — see INVERTED USE above. */
  markColor?: string;
  /** The four corner brackets. */
  bracketColor?: string;
  /** The signal pixel, bottom-right. */
  aqua?: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Moxie"
    >
      <g fill={markColor}>
        <rect x="22" y="21" width="10" height="10" />
        <rect x="22" y="33" width="10" height="10" />
        <rect x="22" y="45" width="10" height="10" />
        <rect x="22" y="57" width="10" height="10" />
        <rect x="22" y="69" width="10" height="10" />
        <rect x="68" y="21" width="10" height="10" />
        <rect x="68" y="33" width="10" height="10" />
        <rect x="68" y="45" width="10" height="10" />
        <rect x="68" y="57" width="10" height="10" />
        <rect x="68" y="69" width="10" height="10" />
        <rect x="34" y="33" width="10" height="10" />
        <rect x="56" y="33" width="10" height="10" />
        <rect x="45" y="45" width="10" height="10" />
      </g>
      <g fill={bracketColor}>
        <rect x="14" y="14" width="10" height="2.5" />
        <rect x="14" y="14" width="2.5" height="10" />
        <rect x="76" y="14" width="10" height="2.5" />
        <rect x="83.5" y="14" width="2.5" height="10" />
        <rect x="14" y="83.5" width="10" height="2.5" />
        <rect x="14" y="76" width="2.5" height="10" />
        <rect x="76" y="83.5" width="10" height="2.5" />
        <rect x="83.5" y="76" width="2.5" height="10" />
      </g>
      <rect x="83.5" y="83.5" width="4" height="4" fill={aqua} />
    </svg>
  );
}

/** Gold body for dark surfaces — the inverted treatment, named so call sites read as intent rather than a hex literal. */
export const INVERTED_MARK_COLOR = "#c9a84c";
