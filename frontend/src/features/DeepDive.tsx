/**
 * Chart cards for the site grid. Each answers one question a reader actually asks:
 *  H1 Light calendar      — in which days do I have light and contact?
 *  H2 Day × hour map      — at what time of each day? (planner)
 *  H3 Compare             — is this really the best site?
 *  H4 Best windows        — when is it worth landing? (teacher, planner)
 *  Events                 — exact rises, sets and eclipses (planner)
 * Hover shows the values; a click moves the scene and timeline to that time.
 */
import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react'
import type { ScenarioEvaluation, TimeInterval } from '../api/types'
import { eclipseIntervals } from '../domain/eclipses'
import { formatDuration, formatUtc, formatUtcDate, previousMonthName } from '../domain/format'
import { useElementSize } from '../hooks'
import { runComparison, summarize } from '../state/runner'
import { durationMs, setState, useStore, type Audience, type SiteSummary } from '../state/store'
import { Button, Card, Delta, DownloadIcon, EarthIcon, EclipseIcon, Pending, Segmented, SunIcon } from '../ui'

const DAY = 86_400_000
const HOUR = 3_600_000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function overlap(intervals: TimeInterval[], a: number, b: number): number {
  let total = 0
  for (const iv of intervals) {
    const s = Math.max(a, iv.startMs)
    const e = Math.min(b, iv.endMs)
    if (e > s) total += e - s
  }
  return total
}

function moveTo(ms: number, startMs: number) {
  setState({ cursorOffsetMs: Math.max(0, ms - startMs), playing: false })
}

/* ------------------------------------------------------------------ shared */

interface TipState {
  x: number
  y: number
  content: ReactNode
}

function Tip({ tip }: { tip: TipState | null }) {
  if (!tip) return null
  return (
    <div className="deep-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
}

function ChartCard({ title, question, caption, children }: { title: string; question: string; caption?: string; children: ReactNode }) {
  return (
    <Card as="article" className="panel-card">
      <header className="panel-head">
        <h3 className="ui-title">{title}</h3>
        <p className="ui-small ui-muted">{question}</p>
      </header>
      {children}
      {caption && <p className="ui-small ui-muted">{caption}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ H1 calendar */

function words(h: number, body: 'sun' | 'earth'): string {
  if (body === 'sun') return h < 0.5 ? 'No sunlight' : h < 8 ? 'A little sunlight' : h < 20 ? 'Sunlight part of the day' : 'Sunlight all day'
  return h < 0.5 ? 'Earth hidden' : h < 20 ? 'Earth in view part of the day' : 'Earth in view all day'
}

function LightCalendar({ ev, startMs, days, cursorMs, audience }: { ev: ScenarioEvaluation; startMs: number; days: number; cursorMs: number; audience: Audience }) {
  const [tip, setTip] = useState<TipState | null>(null)
  const cells = useMemo(
    () =>
      Array.from({ length: days }, (_, d) => {
        const a = startMs + d * DAY
        return { a, sunH: overlap(ev.intervals.sun, a, a + DAY) / HOUR, earthH: overlap(ev.intervals.earth, a, a + DAY) / HOUR }
      }),
    [ev, startMs, days],
  )
  const lead = (new Date(startMs).getUTCDay() + 6) % 7
  const today = Math.floor((cursorMs - startMs) / DAY)

  return (
    <div className="deep-chart" onPointerLeave={() => setTip(null)}>
      <span className="ui-small ui-muted">
        {formatUtcDate(startMs)} – {formatUtcDate(startMs + (days - 1) * DAY)} {new Date(startMs + (days - 1) * DAY).getUTCFullYear()}
      </span>
      <div className="cal" role="grid" aria-label="Light calendar">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-dow" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} aria-hidden="true" />
        ))}
        {cells.map((c, d) => {
          const date = new Date(c.a)
          const label = date.getUTCDate() === 1 && d > 0 ? formatUtcDate(c.a) : String(date.getUTCDate())
          const text =
            audience === 'public'
              ? `${formatUtcDate(c.a)}: ${words(c.sunH, 'sun')}, ${words(c.earthH, 'earth').toLowerCase()}`
              : `${formatUtcDate(c.a)}: Sun ${Math.round(c.sunH)} h, Earth ${Math.round(c.earthH)} h`
          const show = (el: HTMLElement) => {
            const host = el.closest('.deep-chart')?.getBoundingClientRect()
            const r = el.getBoundingClientRect()
            if (host) setTip({ x: r.left - host.left + r.width / 2, y: r.top - host.top - 8, content: text })
          }
          return (
            <button
              key={c.a}
              type="button"
              className={`cal-day${d === today ? ' is-now' : ''}`}
              aria-label={`${text}. Go to this day.`}
              onPointerEnter={(e) => show(e.currentTarget)}
              onFocus={(e) => show(e.currentTarget)}
              onBlur={() => setTip(null)}
              onClick={() => moveTo(c.a + 12 * HOUR, startMs)}
            >
              <span className="cal-date">{label}</span>
              <span className="cal-bar" aria-hidden="true">
                <span style={{ width: `${(c.sunH / 24) * 100}%`, background: 'var(--sun)' }} />
              </span>
              <span className="cal-bar" aria-hidden="true">
                <span style={{ width: `${(c.earthH / 24) * 100}%`, background: 'var(--earth)' }} />
              </span>
            </button>
          )
        })}
      </div>
      <Tip tip={tip} />
      <div className="deep-legend">
        <span>
          <SunIcon size={16} /> {audience === 'public' ? 'Sunlight' : 'Hours of sunlight'}
        </span>
        <span>
          <EarthIcon size={16} /> {audience === 'public' ? 'Earth in view' : 'Hours with Earth in view'}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ H2 day × hour */

type Cell = 0 | 1 | 2 | 3 // none, sun, earth, both
const CELL_FILL = ['var(--line-soft)', 'var(--sun)', 'var(--earth)', 'var(--ink-2)']
const CELL_NAME = ['Neither', 'Sun only', 'Earth only', 'Sun and Earth']

function DayHourMap({ ev, startMs, days, cursorMs }: { ev: ScenarioEvaluation; startMs: number; days: number; cursorMs: number }) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const grid = useMemo(() => {
    const g: Cell[][] = []
    for (let d = 0; d < days; d++) {
      const row: Cell[] = []
      for (let h = 0; h < 24; h++) {
        const a = startMs + d * DAY + h * HOUR
        const s = overlap(ev.intervals.sun, a, a + HOUR) >= HOUR / 2
        const e = overlap(ev.intervals.earth, a, a + HOUR) >= HOUR / 2
        row.push(((s ? 1 : 0) + (e ? 2 : 0)) as Cell)
      }
      g.push(row)
    }
    return g
  }, [ev, startMs, days])

  const w = size.width
  const L = 48
  const T = 8
  const RH = 8
  const cw = w > L ? (w - L) / days : 0
  const h = T + 24 * RH + 32
  const startHour = new Date(startMs).getUTCHours()
  const every = days <= 14 ? 2 : days <= 31 ? 5 : 10
  const nowD = Math.floor((cursorMs - startMs) / DAY)
  const nowH = Math.floor(((cursorMs - startMs) % DAY) / HOUR)

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const d = Math.floor((e.clientX - r.left - L) / cw)
    const hr = Math.floor((e.clientY - r.top - T) / RH)
    if (d < 0 || d >= days || hr < 0 || hr > 23) return setTip(null)
    const at = startMs + d * DAY + hr * HOUR
    setTip({
      x: L + d * cw + cw / 2,
      y: T + hr * RH - 8,
      content: (
        <>
          {formatUtc(at)} UTC
          <br />
          {CELL_NAME[grid[d][hr]]}
        </>
      ),
    })
  }

  return (
    <div className="deep-chart" ref={ref}>
      {w > 0 && (
        <svg
          width={w}
          height={h}
          className="deep-svg is-clickable"
          role="img"
          aria-label="One column per day, one row per hour, coloured by what is visible. Click to go to that hour."
          onPointerMove={onMove}
          onPointerLeave={() => setTip(null)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const d = Math.floor((e.clientX - r.left - L) / cw)
            const hr = Math.floor((e.clientY - r.top - T) / RH)
            if (d >= 0 && d < days && hr >= 0 && hr < 24) moveTo(startMs + d * DAY + hr * HOUR, startMs)
          }}
        >
          {grid.map((row, d) =>
            row.map((c, hr) => <rect key={`${d}-${hr}`} x={L + d * cw + 0.5} y={T + hr * RH + 0.5} width={Math.max(1, cw - 1)} height={RH - 1} fill={CELL_FILL[c]} />),
          )}
          {nowD >= 0 && nowD < days && <rect x={L + nowD * cw} y={T + nowH * RH} width={cw} height={RH} fill="none" stroke="var(--primary)" strokeWidth={1.5} />}
          {[0, 6, 12, 18].map((hr) => (
            <text key={hr} x={L - 8} y={T + hr * RH + 8} textAnchor="end" className="deep-axis">
              {String((startHour + hr) % 24).padStart(2, '0')}h
            </text>
          ))}
          {Array.from({ length: Math.floor((days - 1) / every) + 1 }, (_, i) => i * every).map((d) => (
            <text key={d} x={L + d * cw + cw / 2} y={h - 8} textAnchor={L + d * cw + cw / 2 > w - 48 ? 'end' : 'middle'} className="deep-axis">
              {formatUtcDate(startMs + d * DAY)}
            </text>
          ))}
        </svg>
      )}
      <Tip tip={tip} />
      <div className="deep-legend">
        {[1, 2, 3, 0].map((c) => (
          <span key={c}>
            <i className="deep-key" style={{ background: CELL_FILL[c] }} />
            {CELL_NAME[c]}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ H3 compare */

interface Metric {
  label: string
  get: (s: SiteSummary) => number
  show: (v: number) => string
  unit: string
  better: 'higher' | 'lower'
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const METRICS: Record<'sun' | 'earth' | 'both' | 'night', Metric> = {
  sun: { label: 'Sunlight', get: (s) => s.sun, show: pct, unit: '', better: 'higher' },
  earth: { label: 'Earth in view', get: (s) => s.earth, show: pct, unit: '', better: 'higher' },
  both: { label: 'Sun and Earth together', get: (s) => s.both, show: pct, unit: '', better: 'higher' },
  night: { label: 'Longest night', get: (s) => s.nightH, show: (v) => `${Math.round(v)} h`, unit: ' h', better: 'lower' },
}

function CompareBars({ audience, own }: { audience: Audience; own: { name: string; now: SiteSummary; prev: SiteSummary | null } }) {
  const comparison = useStore((s) => s.comparison)
  const startMs = useStore((s) => s.scenarios.A.input.startMs)
  const rows = [{ ...own, me: true }, ...(comparison?.items ?? []).map((i) => ({ ...i, me: false }))]
  const metrics = audience === 'public' ? [METRICS.sun, METRICS.earth] : [METRICS.sun, METRICS.earth, METRICS.both, METRICS.night]
  const delta = (m: Metric, now: SiteSummary, prev: SiteSummary | null) =>
    prev ? <Delta value={m.unit ? m.get(now) - m.get(prev) : (m.get(now) - m.get(prev)) * 100} unit={m.unit} better={m.better} /> : null

  return (
    // Holds about the height of the bars, so the card does not grow when they arrive.
    <Pending ready={!comparison?.busy} bare note="Working out the other sites…" minHeight={metrics.length * 168}>
      <div className="cmp">
        {metrics.map((m) => {
          const max = Math.max(...rows.map((r) => m.get(r.now)), 1e-6)
          const sorted = [...rows].sort((a, b) => (m.better === 'higher' ? m.get(b.now) - m.get(a.now) : m.get(a.now) - m.get(b.now)))
          return (
            <div key={m.label} className="cmp-metric">
              <span className="cmp-label">
                {m.label}
                {m.better === 'lower' && <span className="ui-muted"> · shorter is better</span>}
              </span>
              {sorted.map((r) => (
                <div key={r.name} className={`cmp-row${r.me ? ' is-me' : ''}`}>
                  <span className="cmp-name">{r.name.split(' · ')[0]}</span>
                  <span className="cmp-track" aria-hidden="true">
                    <span style={{ width: `${(m.get(r.now) / max) * 100}%` }} />
                  </span>
                  {audience !== 'public' && (
                    <span className="cmp-value mono">
                      {m.show(m.get(r.now))} {audience === 'planner' && delta(m, r.now, r.prev)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        })}
        {audience === 'planner' && <p className="ui-small ui-muted">Same days for every site. Changes vs the same days in {previousMonthName(startMs)}.</p>}
      </div>
    </Pending>
  )
}

/* ------------------------------------------------------------------ H4 best windows */

const MIN_OPTIONS = [
  { value: 24, label: '1 day' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
]

function BestWindows({ ev, startMs, span, audience }: { ev: ScenarioEvaluation; startMs: number; span: number; audience: Audience }) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [minH, setMinH] = useState(72)
  const endMs = startMs + span
  const windows = ev.intervals.both
    .map((iv) => ({ a: Math.max(startMs, iv.startMs), b: Math.min(endMs, iv.endMs) }))
    .filter((iv) => iv.b > iv.a)
  const ok = windows.filter((iv) => iv.b - iv.a >= minH * HOUR).sort((x, y) => y.b - y.a - (x.b - x.a))
  const best = ok[0]
  const w = size.width
  const x = (ms: number) => ((ms - startMs) / span) * w
  const days = span / DAY
  const every = days <= 14 ? 2 : days <= 31 ? 5 : 15
  const range = (iv: { a: number; b: number }) => `${formatUtcDate(iv.a)} – ${formatUtcDate(iv.b)}`

  return (
    <div className="deep-chart" ref={ref}>
      <div className="deep-toolbar">
        <span className="ui-small ui-muted">At least</span>
        <Segmented label="Shortest window to count" size="s" tone="sunk" value={minH} onChange={setMinH} options={MIN_OPTIONS} />
      </div>
      <p className="deep-answer">{best ? `Best window: ${range(best)}, ${formatDuration(best.b - best.a)}` : 'No window that long in this period.'}</p>
      {w > 0 && (
        <svg width={w} height={56} className="deep-svg" role="img" aria-label="Periods with the Sun and Earth visible together; long enough ones are dark, the best is outlined.">
          <rect x={0} y={8} width={w} height={16} rx={8} fill="var(--line-soft)" />
          {windows.map((iv) => {
            const long = iv.b - iv.a >= minH * HOUR
            return (
              <rect
                key={iv.a}
                x={x(iv.a)}
                y={8}
                width={Math.max(2, x(iv.b) - x(iv.a))}
                height={16}
                rx={4}
                fill={long ? 'var(--ink-2)' : 'var(--line)'}
                className={long ? 'is-clickable' : undefined}
                onClick={long ? () => moveTo(iv.a, startMs) : undefined}
              >
                <title>{`${range(iv)} · ${formatDuration(iv.b - iv.a)}`}</title>
              </rect>
            )
          })}
          {best && <rect x={x(best.a) - 2} y={4} width={x(best.b) - x(best.a) + 4} height={24} rx={8} fill="none" stroke="var(--primary)" strokeWidth={1.5} />}
          {Array.from({ length: Math.floor(days / every) + 1 }, (_, i) => i * every).map((d) => (
            <text key={d} x={x(startMs + d * DAY)} y={48} textAnchor={d === 0 ? 'start' : x(startMs + d * DAY) > w - 48 ? 'end' : 'middle'} className="deep-axis">
              {formatUtcDate(startMs + d * DAY)}
            </text>
          ))}
        </svg>
      )}
      {ok.length > 0 && (
        <ol className="deep-list">
          {ok.slice(0, audience === 'planner' ? 6 : 3).map((iv) => (
            <li key={iv.a}>
              <button type="button" className="ranking-link" onClick={() => moveTo(iv.a, startMs)}>
                {audience === 'planner' ? `${formatUtc(iv.a)} → ${formatUtc(iv.b)} UTC` : range(iv)}
              </button>
              <span className="mono ui-muted">{formatDuration(iv.b - iv.a)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ events (planner) */

interface Event {
  ms: number
  kind: 'Sunrise' | 'Sunset' | 'Earthrise' | 'Earthset' | 'Eclipse starts' | 'Eclipse ends'
}

function events(evaluation: ScenarioEvaluation, startMs: number, endMs: number): Event[] {
  const out: Event[] = []
  const add = (ivs: TimeInterval[], on: Event['kind'], off: Event['kind']) => {
    for (const iv of ivs) {
      if (iv.startMs > startMs + 60_000) out.push({ ms: iv.startMs, kind: on })
      if (iv.endMs < endMs - 60_000) out.push({ ms: iv.endMs, kind: off })
    }
  }
  add(evaluation.intervals.sun, 'Sunrise', 'Sunset')
  add(evaluation.intervals.earth, 'Earthrise', 'Earthset')
  add(eclipseIntervals(evaluation), 'Eclipse starts', 'Eclipse ends')
  return out.sort((a, b) => a.ms - b.ms)
}

function exportEvents(list: Event[], name: string | null) {
  const csv = ['event,utc', ...list.map((e) => `${e.kind},${new Date(e.ms).toISOString()}`)].join('\n')
  const url = URL.createObjectURL(new Blob([`${csv}\n`], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name ?? 'custom-point').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-events.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function EventList({ list, name, startMs }: { list: Event[]; name: string | null; startMs: number }) {
  const icon = (k: Event['kind']) => (k.startsWith('Sun') ? <SunIcon size={16} /> : k.startsWith('Earth') ? <EarthIcon size={16} /> : <EclipseIcon size={16} />)
  return (
    <div className="deep-chart">
      <div className="deep-toolbar">
        <Button variant="secondary" size="s" icon={<DownloadIcon />} onClick={() => exportEvents(list, name)}>
          Events CSV
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="ui-muted">Nothing rises or sets in this period.</p>
      ) : (
        <ol className="deep-list is-scroll">
          {list.map((e) => (
            <li key={`${e.kind}-${e.ms}`}>
              <button type="button" className="ranking-link mono" onClick={() => moveTo(e.ms, startMs)}>
                {formatUtc(e.ms)}
              </button>
              <span className="deep-event">
                {icon(e.kind)}
                {e.kind}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ cards for the site grid */

function useDeep() {
  const A = useStore((s) => s.scenarios.A)
  const offset = useStore((s) => s.cursorOffsetMs)
  const span = useStore(durationMs)
  const { evaluation, previous } = A.run
  if (!evaluation) return null
  const startMs = A.input.startMs
  return { A, evaluation, previous, startMs, span, days: Math.round(span / DAY), cursorMs: startMs + offset }
}

export function LightCalendarCard({ audience }: { audience: Audience }) {
  const d = useDeep()
  if (!d) return null
  return (
    <ChartCard
      title="Light calendar"
      question={audience === 'public' ? 'Which days have sunlight and a radio link?' : 'Hours of sunlight and of Earth in view, day by day.'}
    >
      <LightCalendar ev={d.evaluation} startMs={d.startMs} days={d.days} cursorMs={d.cursorMs} audience={audience} />
    </ChartCard>
  )
}

export function DayHourCard() {
  const d = useDeep()
  if (!d) return null
  return (
    <ChartCard title="Day by hour" question="What can you see at each hour of each day? Click a square to go there.">
      <DayHourMap ev={d.evaluation} startMs={d.startMs} days={d.days} cursorMs={d.cursorMs} />
    </ChartCard>
  )
}

export function WindowsCard({ audience }: { audience: Audience }) {
  const d = useDeep()
  if (!d) return null
  return (
    <ChartCard title="Best windows to land" question="When do the Sun and Earth stay visible together for long enough?">
      <BestWindows ev={d.evaluation} startMs={d.startMs} span={d.span} audience={audience} />
    </ChartCard>
  )
}

export function CompareCard({ audience }: { audience: Audience }) {
  const d = useDeep()
  const regions = useStore((s) => s.regions)
  const area = useStore((s) => s.area)
  const mission = useStore((s) => s.mission)
  const evaluation = d?.evaluation
  // The comparison follows the site, the period and the selected area.
  useEffect(() => {
    if (evaluation && regions) void runComparison()
  }, [evaluation, regions, area, mission])
  if (!d) return null
  const own = {
    name: d.A.input.siteName ?? 'This point',
    now: summarize(d.evaluation, d.startMs, d.startMs + d.span),
    prev: d.previous ? summarize(d.previous, d.startMs - d.span, d.startMs) : null,
  }
  return (
    <ChartCard
      title={audience === 'public' ? 'How does this place compare?' : 'Compared with the best sites'}
      question={audience === 'public' ? 'This place next to the top three of the ranking.' : 'This site next to the top three of the ranking, same days.'}
    >
      <CompareBars audience={audience} own={own} />
    </ChartCard>
  )
}

export function EventsCard() {
  const d = useDeep()
  const ev = d?.evaluation
  const from = d?.startMs ?? 0
  const span = d?.span ?? 0
  const list = useMemo(() => (ev ? events(ev, from, from + span) : []), [ev, from, span])
  if (!d) return null
  return (
    <ChartCard title="Events" question="Rises, sets and eclipses, in UTC." caption="Centre of the disc against the terrain horizon.">
      <EventList list={list} name={d.A.input.siteName} startMs={d.startMs} />
    </ChartCard>
  )
}
