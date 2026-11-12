/** How deep a transaction is once nothing about it moves any more: the
    pill stops counting there, and the pie has one part per block on the
    way. */
export const SETTLED = 6;

const CENTRE = 12;
const RADIUS = 10;

/** A coordinate short enough for a path, without the float noise of the
    trigonometry (12.000000000000002 is 12). */
function coord(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** The parts to fill: whole blocks, none below zero or for a count
    that is not a number, the whole disc from six up. */
function filledParts(parts: number): number {
  if (!Number.isFinite(parts)) return 0;
  return Math.min(SETTLED, Math.max(0, Math.floor(parts)));
}

/** The filled sector for `parts` of SETTLED: from noon, clockwise, 60°
    a part, from the centre out to the radius. No parts is no sector;
    all of them is the whole disc, which one arc cannot draw (its two
    ends would meet), so it takes two half turns. */
export function pieSectorPath(parts: number): string {
  const filled = filledParts(parts);
  const top = CENTRE - RADIUS;
  if (filled === 0) return "";
  if (filled === SETTLED) {
    const bottom = CENTRE + RADIUS;
    return `M${CENTRE} ${top}A${RADIUS} ${RADIUS} 0 1 1 ${CENTRE} ${bottom}A${RADIUS} ${RADIUS} 0 1 1 ${CENTRE} ${top}Z`;
  }
  const angle = (filled / SETTLED) * 2 * Math.PI;
  const x = coord(CENTRE + RADIUS * Math.sin(angle));
  const y = coord(CENTRE - RADIUS * Math.cos(angle));
  // Past half a turn the arc has to go the long way round.
  const large = angle > Math.PI ? 1 : 0;
  return `M${CENTRE} ${CENTRE}L${CENTRE} ${top}A${RADIUS} ${RADIUS} 0 ${large} 1 ${x} ${y}Z`;
}

/** The count of confirmations as a shape: a ring, filled a sixth per
    block. One sector and no dividers between the parts: at 12px the
    dividers were noise, and the share of the disc reads alone. Drawn
    in the colour of the text around it, like the check it replaces.
    `data-parts` names the count for a test, which should not read a
    path. */
export function ConfirmationPie({ parts, size = 12 }: { parts: number; size?: number }) {
  const filled = filledParts(parts);
  const sector = pieSectorPath(filled);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      data-glyph="pie"
      data-parts={filled}
      className="shrink-0"
    >
      <circle cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" stroke="currentColor" strokeWidth={2} />
      {sector && <path d={sector} fill="currentColor" />}
    </svg>
  );
}
