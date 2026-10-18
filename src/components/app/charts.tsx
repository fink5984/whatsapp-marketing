"use client";

/**
 * Chart primitives (Recharts). Palette: validated categorical tokens
 * --chart-1..5 in fixed order (light + dark validated separately).
 * Specs: 2px lines, ≤24px bars with 4px rounded data-ends, hairline solid
 * grid, crosshair tooltip, legend for ≥2 series, text in text tokens.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type Series = { key: string; label: string; color: 1 | 2 | 3 | 4 | 5 };

const color = (n: number) => `var(--chart-${n})`;
const nf = new Intl.NumberFormat("he-IL", { notation: "compact", maximumFractionDigits: 1 });
const nfFull = new Intl.NumberFormat("he-IL");

/** Serializable number formats (functions cannot cross the server→client boundary). */
export type ValueFormat = "number" | "percent" | { currency: string };
function formatter(f: ValueFormat | undefined, compact: boolean): (v: number) => string {
  if (f === "percent") return (v) => `${v}%`;
  if (f && typeof f === "object") {
    const cf = new Intl.NumberFormat("he-IL", { style: "currency", currency: f.currency, maximumFractionDigits: 2 });
    return (v) => cf.format(v);
  }
  return (v) => (compact ? nf.format(v) : nfFull.format(v));
}

const axisProps = {
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;

function ChartTooltip({ active, payload, label, valueFormat }: { active?: boolean; payload?: Array<{ color?: string; name?: string; value?: number | string }>; label?: string; valueFormat?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md" dir="rtl">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="tabular ms-auto ps-3 font-medium text-foreground">
              {typeof p.value === "number" ? (valueFormat ? valueFormat(p.value) : nfFull.format(p.value)) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendRow({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full" style={{ background: color(s.color), height: 3 }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function TimeLineChart({
  data,
  xKey,
  series,
  height = 260,
  area,
  valueFormat,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  height?: number;
  area?: boolean;
  valueFormat?: ValueFormat;
}) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <div dir="ltr">
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
          <XAxis dataKey={xKey} {...axisProps} minTickGap={24} tickFormatter={(v: string) => (v.length === 10 ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : v.slice(-5))} />
          <YAxis {...axisProps} axisLine={false} width={44} allowDecimals={false} tickFormatter={formatter(valueFormat, true)} />
          <Tooltip content={<ChartTooltip valueFormat={formatter(valueFormat, false)} />} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeOpacity: 0.4 }} />
          {series.map((s) =>
            area ? (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s.color)} strokeWidth={2} fill={color(s.color)} fillOpacity={0.1} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
            ) : (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(s.color)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
            ),
          )}
          <Legend content={() => <LegendRow series={series} />} />
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBarChart({
  data,
  xKey,
  series,
  height = 260,
  stacked,
  horizontal,
  valueFormat,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  valueFormat?: ValueFormat;
}) {
  return (
    <div dir="ltr">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--border)" strokeWidth={1} />
          {horizontal ? (
            <>
              <XAxis type="number" {...axisProps} allowDecimals={false} tickFormatter={(v: number) => nf.format(v)} />
              <YAxis type="category" dataKey={xKey} {...axisProps} width={120} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} {...axisProps} interval={0} tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
              <YAxis {...axisProps} axisLine={false} width={44} allowDecimals={false} tickFormatter={formatter(valueFormat, true)} />
            </>
          )}
          <Tooltip content={<ChartTooltip valueFormat={formatter(valueFormat, false)} />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={color(s.color)}
              maxBarSize={24}
              stackId={stacked ? "s" : undefined}
              stroke={stacked ? "var(--card)" : undefined}
              strokeWidth={stacked ? 2 : 0}
              radius={!stacked || i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            />
          ))}
          <Legend content={() => <LegendRow series={series} />} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
