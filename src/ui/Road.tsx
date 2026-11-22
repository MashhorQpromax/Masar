import Link from "next/link";
import type { CSSProperties } from "react";
import type { StationKey } from "@/domain/deal";
import { initial } from "@/copy/format";

type Side = "above" | "below" | "left" | "right";

interface Geometry {
  name: "wide" | "tall";
  width: number;
  height: number;
  /** The road, from the study to the disbursement. */
  path: string;
  roadWidth: number;
  node: number;
  sun: number;
  points: Record<StationKey, { x: number; y: number; token: Side; label: Side }>;
  decor: { cx: number; cy: number; r: number; fill: string }[];
}

/** Landscape road for wide screens: enters from the right and winds to the sun on the left. */
const WIDE: Geometry = {
  name: "wide",
  width: 1440,
  height: 560,
  path: "M1440 236C1390 236 1330 260 1260 260C1180 260 1100 180 1020 180C930 180 880 350 800 350C720 350 670 230 590 230C500 230 470 400 380 400C300 400 250 290 170 290",
  roadWidth: 24,
  node: 15,
  sun: 26,
  points: {
    study: { x: 1260, y: 260, token: "above", label: "below" },
    settle: { x: 1020, y: 180, token: "above", label: "below" },
    credit: { x: 800, y: 350, token: "below", label: "above" },
    property: { x: 590, y: 230, token: "above", label: "below" },
    bank: { x: 380, y: 400, token: "below", label: "above" },
    payout: { x: 170, y: 290, token: "above", label: "below" },
  },
  decor: [
    { cx: 170, cy: 290, r: 78, fill: "#fff6d9" },
    { cx: 700, cy: 560, r: 120, fill: "#f3f5f7" },
    { cx: 1130, cy: 20, r: 90, fill: "#f3f5f7" },
  ],
};

/** Portrait road for phones: starts at the top and winds down to the sun. */
const TALL: Geometry = {
  name: "tall",
  width: 390,
  height: 760,
  path: "M296 -14C296 20 296 40 296 64C296 142 94 110 94 188C94 266 296 234 296 312C296 390 94 358 94 436C94 514 296 482 296 560C296 640 94 608 94 688",
  roadWidth: 20,
  node: 13,
  sun: 22,
  points: {
    study: { x: 296, y: 64, token: "left", label: "right" },
    settle: { x: 94, y: 188, token: "right", label: "left" },
    credit: { x: 296, y: 312, token: "left", label: "right" },
    property: { x: 94, y: 436, token: "right", label: "left" },
    bank: { x: 296, y: 560, token: "left", label: "right" },
    payout: { x: 94, y: 688, token: "right", label: "left" },
  },
  decor: [
    { cx: 94, cy: 688, r: 60, fill: "#fff6d9" },
    { cx: 350, cy: 750, r: 90, fill: "#f3f5f7" },
    { cx: 30, cy: 30, r: 70, fill: "#f3f5f7" },
  ],
};

const ORDER: StationKey[] = ["study", "settle", "credit", "property", "bank", "payout"];
/** Width of the line around a station. */
const OUTLINE = 5;

export type TokenTone = "hot" | "bad" | "warn" | "plain";

/** The deal shown at a station. When several deals share a station, the most pressing one is shown. */
export interface RoadToken {
  station: StationKey;
  href: string;
  name: string;
  text: string;
  tone: TokenTone;
  /** Other deals at the same station. */
  more: number;
  moreHref: string;
  moreLabel: string;
}

interface RoadProps {
  labels: Record<StationKey, string>;
  tokens: RoadToken[];
  description: string;
}

function Drawing({ g, tokens, labels, description }: RoadProps & { g: Geometry }) {
  // A label or a token stands off its station: the node's outer radius in drawing units, plus a clearance in pixels.
  const at = (key: StationKey, clearance: number): CSSProperties =>
    ({
      left: `${(g.points[key].x / g.width) * 100}%`,
      top: `${(g.points[key].y / g.height) * 100}%`,
      "--r": (key === "payout" ? g.sun : g.node) + OUTLINE / 2,
      "--pad": `${clearance}px`,
    }) as CSSProperties;
  // A token is joined to its station by a short pointer. Beside the road it stands further out.
  const reach = g.name === "tall" ? 19 : 15;
  const end = g.points.payout;

  return (
    <div className={`road road--${g.name}`}>
      <svg viewBox={`0 0 ${g.width} ${g.height}`} fill="none" role="img" aria-label={description}>
        {g.decor.map((c) => (
          <circle key={`${c.cx}-${c.cy}`} {...c} />
        ))}
        <path className="road-line" pathLength={1} d={g.path} stroke="#0f2a43" strokeWidth={g.roadWidth} strokeLinecap="round" />
        <path className="road-dash" d={g.path} stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        {ORDER.filter((key) => key !== "payout").map((key) => (
          <circle key={key} cx={g.points[key].x} cy={g.points[key].y} r={g.node} fill="#fff" stroke="#0f2a43" strokeWidth={OUTLINE} />
        ))}
        <circle className="road-ring" cx={end.x} cy={end.y} r={g.sun} stroke="#ffc233" strokeWidth={2} />
        <circle cx={end.x} cy={end.y} r={g.sun} fill="#ffc233" stroke="#0f2a43" strokeWidth={OUTLINE} />
      </svg>

      {ORDER.map((key) => (
        <span
          key={key}
          className={key === "payout" ? "station station--end" : "station"}
          data-side={g.points[key].label}
          style={at(key, 6)}
        >
          {labels[key]}
        </span>
      ))}

      {tokens.map((token, index) => (
        <div
          key={token.href}
          className="token"
          data-side={g.points[token.station].token}
          data-tone={token.tone}
          style={{ ...at(token.station, reach), animationDelay: `${0.9 + index * 0.15}s` }}
        >
          <Link className="token-main" href={token.href}>
            <span className="avatar" aria-hidden="true">
              {initial(token.name)}
            </span>
            <span>
              <b>{token.name}</b>
              <small>{token.text}</small>
            </span>
          </Link>
          {token.more > 0 && (
            <Link className="token-more num" href={token.moreHref} aria-label={token.moreLabel}>
              +{token.more}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The road every deal travels, with each deal standing at its station.
 * Drawn twice, landscape and portrait; the stylesheet shows the one that fits the screen.
 */
export function Road(props: RoadProps) {
  return (
    <div className="road-card">
      <Drawing g={WIDE} {...props} />
      <Drawing g={TALL} {...props} />
    </div>
  );
}
