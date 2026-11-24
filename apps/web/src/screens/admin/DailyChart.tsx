"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { dollars, tokens } from "../../lib/format";
import { scaleTicks, type DayPoint } from "./daily";

/*
 * The month's cost day by day: one column per day in the product's one hue, square corners, a 2px
 * gap, four grey ticks on the left and the day of the month under every seventh column. Days
 * that have not happened are not drawn. Each column names its day, cost and tokens on hover.
 * The chart is drawn at the width it has, so its text stays 12px on a phone instead of scaling.
 */

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 60 };

function useWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function DailyChart({ series, daysInMonth }: { series: DayPoint[]; daysInMonth: number }) {
  const [ref, WIDTH] = useWidth(840);
  const max = Math.max(0, ...series.map((p) => p.costMicros));
  const ticks = scaleTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / daysInMonth;
  const bar = Math.max(2, slot - 2);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} role="img" aria-label={`Cost per day, ${series.length} days drawn`} style={{ display: "block" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--control)" : "var(--rule)"} strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
            {dollars(t)}
          </text>
        </g>
      ))}
      {series.map((p, i) => {
        const h = Math.max(0, y(0) - y(p.costMicros));
        const day = Number(p.day.slice(-2));
        return (
          <g key={p.day}>
            {p.costMicros > 0 ? <rect x={PAD.left + i * slot + 1} y={y(p.costMicros)} width={bar} height={h} fill="var(--accent)" /> : null}
            <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent">
              <title>{`${p.day}: ${dollars(p.costMicros)}, ${tokens(p.tokens)}`}</title>
            </rect>
            {day === 1 || day % 7 === 1 ? (
              <text x={PAD.left + i * slot + slot / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill="var(--muted)">
                {day}
              </text>
            ) : null}
          </g>
        );
      })}
      </svg>
    </div>
  );
}
