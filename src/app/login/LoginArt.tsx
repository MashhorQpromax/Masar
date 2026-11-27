import { STATION } from "@/copy/deal";
import type { StationKey } from "@/domain/deal";

interface Point {
  x: number;
  y: number;
}

/** A road through the points, level at each one, the way the home road is drawn. */
function wave(points: Point[]): string {
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const half = (from.x - to.x) / 2;
    d += `C${from.x - half} ${from.y} ${to.x + half} ${to.y} ${to.x} ${to.y}`;
  }
  return d;
}

const ORDER: StationKey[] = ["study", "settle", "credit", "property", "bank", "payout"];

/**
 * The road on the large card: in from the right, over a rise and a dip for each station, down to the sun.
 * Every station is the top of a rise or the bottom of a dip, so its name always has clear ground.
 */
const CARD = {
  width: 800,
  height: 800,
  enter: { x: 990, y: 300 },
  stations: [
    { x: 690, y: 170, label: "above" },
    { x: 578, y: 322, label: "below" },
    { x: 466, y: 232, label: "above" },
    { x: 354, y: 412, label: "below" },
    { x: 242, y: 322, label: "above" },
    { x: 126, y: 548, label: "below" },
  ] as (Point & { label: "above" | "below" })[],
  decor: [
    { cx: 90, cy: 40, r: 120 },
    { cx: 470, cy: 800, r: 130 },
  ],
};

/** The same road as a band, for a phone: no names, the shape is enough. */
const BAND = {
  width: 390,
  height: 132,
  enter: { x: 430, y: 40 },
  decor: [] as { cx: number; cy: number; r: number }[],
  stations: [
    { x: 338, y: 46 },
    { x: 280, y: 92 },
    { x: 222, y: 44 },
    { x: 164, y: 90 },
    { x: 108, y: 46 },
    { x: 50, y: 80 },
  ] as Point[],
};

function Drawing({ id, g, roadWidth, node, sun, names }: { id: string; g: typeof CARD | typeof BAND; roadWidth: number; node: number; sun: number; names: boolean }) {
  const path = wave([g.enter, ...g.stations]);
  const end = g.stations[g.stations.length - 1]!;
  const outline = roadWidth / 5;
  return (
    <svg viewBox={`0 0 ${g.width} ${g.height}`} fill="none" aria-hidden="true">
      {g.decor.map((c) => (
        <circle key={c.cx} {...c} fill="#f3f5f7" />
      ))}
      <circle cx={end.x} cy={end.y} r={sun * 3} fill="#fff6d9" />
      <path id={id} className="road-line" pathLength={1} d={path} stroke="#0f2a43" strokeWidth={roadWidth} strokeLinecap="round" />
      <path className="road-dash" d={path} stroke="#fff" strokeWidth={roadWidth / 10} strokeLinecap="round" />
      {g.stations.slice(0, -1).map((p) => (
        <circle key={p.x} cx={p.x} cy={p.y} r={node} fill="#fff" stroke="#0f2a43" strokeWidth={outline} />
      ))}
      <circle className="road-ring" cx={end.x} cy={end.y} r={sun} stroke="#ffc233" strokeWidth={2} />
      <circle cx={end.x} cy={end.y} r={sun} fill="#ffc233" stroke="#0f2a43" strokeWidth={outline} />
      {/* A deal on its way: it leaves the start, reaches the sun, and the next one sets out. */}
      <circle className="login-traveller" r={node * 0.62} fill="#ff5a3c" stroke="#fff" strokeWidth={outline * 0.7}>
        <animateMotion dur="11s" begin="1.6s" repeatCount="indefinite" calcMode="linear" keyPoints="0;1;1" keyTimes="0;0.88;1">
          <mpath href={`#${id}`} />
        </animateMotion>
      </circle>
      {names &&
        (g as typeof CARD).stations.map((p, i) => (
          <text
            key={ORDER[i]}
            className={i === ORDER.length - 1 ? "login-station login-station--end" : "login-station"}
            x={p.x}
            y={p.label === "below" ? p.y + (i === ORDER.length - 1 ? sun : node) + 30 : p.y - node - 16}
            textAnchor="middle"
          >
            {STATION[ORDER[i]!]}
          </text>
        ))}
    </svg>
  );
}

/** The picture beside the sign-in form: the road every deal travels, from the first study to the payout. */
export function LoginArt({ as }: { as: "card" | "band" }) {
  if (as === "band") {
    return (
      <div className="login-band">
        <Drawing id="login-road-band" g={BAND} roadWidth={15} node={9} sun={15} names={false} />
      </div>
    );
  }
  return (
    <div className="login-art">
      <Drawing id="login-road-card" g={CARD} roadWidth={30} node={17} sun={30} names />
      <p className="login-caption">
        من أول مكالمة
        <br />
        إلى صرف التمويل.
      </p>
    </div>
  );
}
