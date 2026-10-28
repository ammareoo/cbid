import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type ChartTone = 'brand' | 'teal' | 'sky' | 'green' | 'accent' | 'muted';

/** CBID logo palette — rotate for multi-series charts when a datum has no tone. */
export const CHART_SERIES_TONES: ChartTone[] = ['brand', 'accent', 'teal', 'green', 'sky'];

export function Kpi({ icon, value, label, sub, tone = 'brand' }: {
  icon: ReactNode; value: ReactNode; label: string; sub?: ReactNode; tone?: ChartTone;
}) {
  return (
    <div className={`kpi kpi--${tone}`}>
      <div className="kpi__head">
        <p className="kpi__label">{label}</p>
        <span className="kpi__icon" aria-hidden="true">{icon}</span>
      </div>
      <p className="kpi__value">{value}</p>
      {sub ? <p className="kpi__sub">{sub}</p> : <span className="kpi__sub kpi__sub--placeholder" aria-hidden="true" />}
    </div>
  );
}

export function ChartCard({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="chart-card" aria-labelledby={id}>
      <header className="chart-card__head">
        <h2 id={id} className="chart-card__title">{title}</h2>
        {action}
      </header>
      <div className="chart-card__body">{children}</div>
    </section>
  );
}

const share = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);

export interface BarDatum {
  key: string; label: string; sub?: string; value: number; max?: number; display?: string; href?: string; tone?: ChartTone;
}

/** Horizontal bars with the label and value as visible text; the bar itself is decorative. */
export function BarList({ data, max, empty }: { data: BarDatum[]; max?: number; empty: string }) {
  if (data.length === 0) return <p className="chart-empty">{empty}</p>;
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="bar-list">
      {data.map((d, i) => (
        <li key={d.key}>
          <div className="bar-list__top">
            <span className="bar-list__name">
              {d.href ? <Link to={d.href} className="bar-list__label">{d.label}</Link> : <span className="bar-list__label">{d.label}</span>}
              {d.sub && <span className="bar-list__sub">{d.sub}</span>}
            </span>
            <span className="bar-list__value">{d.display ?? d.value}</span>
          </div>
          <span className="bar-list__track" aria-hidden="true">
            <span
              className={`bar-list__fill chart-tone--${d.tone ?? CHART_SERIES_TONES[i % CHART_SERIES_TONES.length]}`}
              style={{ width: `${share(d.value, d.max ?? top)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ColumnDatum {
  key: string; label: string; title: string; value: number; display?: string; href?: string; tone?: ChartTone;
}

export function ColumnChart({ data, max, empty }: { data: ColumnDatum[]; max?: number; empty: string }) {
  if (data.length === 0) return <p className="chart-empty">{empty}</p>;
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="col-chart">
      {data.map((d, i) => (
        <li key={d.key} className="col-chart__col">
          <span className="col-chart__value"><span className="sr-only">{d.title}: </span>{d.display ?? d.value}</span>
          <span className="col-chart__track" aria-hidden="true">
            <span
              className={`col-chart__fill chart-tone--${d.tone ?? CHART_SERIES_TONES[i % CHART_SERIES_TONES.length]}`}
              style={{ height: `${share(d.value, top)}%`, minHeight: d.value > 0 ? 4 : 0 }}
            />
          </span>
          <span className="col-chart__label" title={d.title}>
            {d.href ? <Link to={d.href}>{d.label}</Link> : d.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface DonutSegment { key: string; label: string; value: number; tone: ChartTone }

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Ring chart; the legend carries every value as text, so the SVG is hidden from assistive tech. */
export function Donut({ segments, centerValue, centerLabel }: { segments: DonutSegment[]; centerValue: ReactNode; centerLabel: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const arcs = segments
    .filter((s) => s.value > 0)
    .reduce<{ s: DonutSegment; len: number; offset: number }[]>((out, s) => {
      const prev = out[out.length - 1];
      out.push({ s, len: (s.value / total) * CIRCUMFERENCE, offset: prev ? prev.offset + prev.len : 0 });
      return out;
    }, []);

  return (
    <div className="donut">
      <div className="donut__ring">
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle className="donut__track" cx="50" cy="50" r={RADIUS} />
          {arcs.map(({ s, len, offset }) => (
            <circle
              key={s.key}
              className={`donut__seg chart-tone--${s.tone}`}
              cx="50" cy="50" r={RADIUS}
              strokeDasharray={`${len} ${CIRCUMFERENCE - len}`}
              strokeDashoffset={-offset}
            />
          ))}
        </svg>
        <div className="donut__center">
          <span className="donut__value">{centerValue}</span>
          <span className="donut__label">{centerLabel}</span>
        </div>
      </div>
      <ul className="donut__legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`donut__swatch chart-tone--${s.tone}`} aria-hidden="true" />
            <span className="donut__legend-label">{s.label}</span>
            <span className="donut__legend-value">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
