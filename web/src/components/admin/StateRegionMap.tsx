import { STATE_OUTLINES, projectToState } from "@/lib/geo/state-outlines";

/**
 * One tracked state's outline with a marker per region, sized by count.
 * Region-level, not a plot of boats: each marker sits at the region's
 * representative harbour (lib/region-config.ts). "Other regions" isn't a
 * place, so it appears in the ranked list beside the map, not on it.
 */
export function StateRegionMap({
  stateCode,
  stateLabel,
  regions,
}: {
  stateCode: "CA" | "FL" | "WA";
  stateLabel: string;
  regions: { key: string; label: string; count: number; marker: { lat: number; lon: number } }[];
}) {
  const outline = STATE_OUTLINES[stateCode];
  const maxCount = Math.max(1, ...regions.map((r) => r.count));

  return (
    <svg
      viewBox={`0 0 ${outline.width} ${outline.height}`}
      className="mx-auto h-auto max-h-[300px] w-full max-w-[260px] overflow-visible"
      role="img"
      aria-label={`Vessels by region, ${stateLabel}: ${regions.map((r) => `${r.label} ${r.count}`).join(", ")}`}
    >
      <path d={outline.path} fill="var(--cream2)" stroke="var(--divider)" strokeWidth={1} />
      {regions.map((r) => {
        const { x, y } = projectToState(outline, r.marker.lat, r.marker.lon);
        // Kept small: SF Bay and the Delta sit ~12 units apart on the CA map.
        const radius = r.count === 0 ? 3.5 : 6 + (r.count / maxCount) * 11;
        const opacity = r.count === 0 ? 0.25 : 0.35 + (r.count / maxCount) * 0.5;
        return (
          <g key={r.key}>
            <title>{`${r.label}: ${r.count}`}</title>
            <circle cx={x} cy={y} r={radius} fill="var(--aqua-bright)" opacity={opacity} />
            <circle cx={x} cy={y} r={1.5} fill="var(--navy)" />
            <text
              x={x}
              y={y - radius - 4}
              textAnchor="middle"
              className="font-[family-name:var(--font-dm)]"
              fontSize={10}
              fill="var(--navy)"
              fontWeight={600}
              stroke="var(--white)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {r.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
