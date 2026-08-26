type Props = { size?: number; className?: string };

const GOLD = "#c9a84c";
const AQUA = "#17C3B2";

/** Pixel M signal mark — sizes per brand guide (handoff). */
export function PixelM({ size = 56, className = "" }: Props) {
  const cells = [
    [15, 25],
    [15, 35],
    [15, 45],
    [15, 55],
    [15, 65],
    [15, 75],
    [25, 35],
    [35, 45],
    [45, 35],
    [55, 45],
    [65, 35],
    [75, 25],
    [75, 35],
    [75, 45],
    [75, 55],
    [75, 65],
    [75, 75],
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width={10} height={10} fill={GOLD} />
      ))}
      <rect x={85} y={85} width={8} height={8} fill={AQUA} />
    </svg>
  );
}
