const CA_OUTLINE =
  "M60,10 L170,10 L165,60 L150,90 L160,130 L155,180 L165,230 L160,280 L170,320 " +
  "L150,360 L140,400 L90,440 L40,410 L25,370 L35,320 L15,270 L30,220 L10,170 " +
  "L25,120 L15,70 Z";

type MapRegion = {
  key: string;
  label: string;
  count: number;
  x: number;
  y: number;
};

const MAP_REGIONS: Omit<MapRegion, "count">[] = [
  { key: "sf_bay_area", label: "SF Bay Area", x: 80, y: 130 },
  { key: "central_coast", label: "Central Coast", x: 100, y: 250 },
  { key: "southern_california", label: "Southern California", x: 115, y: 380 },
];

/**
 * Stylized, not geographically precise -- region-level markers on an
 * approximate CA silhouette. Only the three mappable regions render as
 * points; "Other" and "Unclassified" have no single location and only
 * appear in the ranked list next to this map.
 */
export function AdminGeoMap({ counts }: { counts: Record<string, number> }) {
  const regions: MapRegion[] = MAP_REGIONS.map((r) => ({ ...r, count: counts[r.key] ?? 0 }));
  const maxCount = Math.max(1, ...regions.map((r) => r.count));

  return (
    <svg viewBox="0 0 220 460" className="mx-auto h-[280px] w-auto" role="img" aria-label="Vessel concentration by California region">
      <path d={CA_OUTLINE} fill="var(--cream2)" stroke="var(--divider)" strokeWidth={1.5} />
      {regions.map((r) => {
        const radius = r.count === 0 ? 5 : 10 + (r.count / maxCount) * 26;
        const opacity = r.count === 0 ? 0.25 : 0.35 + (r.count / maxCount) * 0.5;
        return (
          <g key={r.key}>
            <circle cx={r.x} cy={r.y} r={radius} fill="var(--aqua-bright)" opacity={opacity} />
            <circle cx={r.x} cy={r.y} r={2} fill="var(--navy)" />
            <text
              x={r.x}
              y={r.y - radius - 6}
              textAnchor="middle"
              className="font-[family-name:var(--font-dm)]"
              fontSize={11}
              fill="var(--navy)"
              fontWeight={600}
            >
              {r.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
