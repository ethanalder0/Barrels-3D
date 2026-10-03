/**
 * The perforated edge of a stamp, plus the hairline frame inside it.
 *
 * Four strips of half-circles punched out of the card stock along each side.
 * They are painted in the colour BEHIND the card rather than cut out of it —
 * a real cut would need a mask, and the scallops sit over a known ground here
 * (see `--card-perf`), so paint is both cheaper and sharper.
 *
 * Both faces carry a set. Decoration only, so the whole thing is hidden from
 * assistive tech.
 */
export default function CardEdges() {
  return (
    <div className="cardedge" aria-hidden="true">
      <span className="cardedge__strip cardedge__strip--top" />
      <span className="cardedge__strip cardedge__strip--bottom" />
      <span className="cardedge__strip cardedge__strip--left" />
      <span className="cardedge__strip cardedge__strip--right" />
      <span className="cardedge__frame" />
    </div>
  );
}
