/**
 * Up to four horizons side by side on one clock. Every window shows the same
 * UTC instant; the shared timeline below moves all of them together.
 */
import { ArrowUp, Maximize2, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import { currentCompareSite, openComparePicker, SLOT_LETTERS } from '../features/compareSlots'
import { CompareWindow } from '../features/CompareWindow'
import { ExperimentBar } from '../features/Experiment'
import { flatProfile } from '../domain/flat'
import { TopBar } from '../features/TopBar'
import { formatAngle, formatLat, formatLon, formatUtc, formatUtcDate, formatUtcLong, previousMonthName } from '../domain/format'
import { slotStart, slotCursor, comparisonKey } from '../domain/learning'
import { decisionChanges } from '../domain/publicDecision'
import { bodyAt } from '../domain/sampling'
import { usePlayback } from '../hooks'
import { retryCompareSite, syncCompareRuns } from '../state/compareRunner'
import { summarize } from '../state/runner'
import {
  durationMs,
  getState,
  goTo,
  setScenarioInput,
  setState,
  useStore,
  type Audience,
  type CompareSite,
  type CompareView,
  type ScenarioRun,
  type SiteSummary,
} from '../state/store'
import { BackLink, Button, Chip, Delta, IconButton, Notice, Pending, PauseIcon, PlayIcon, Segmented, Select, SpaceWindow, TrackBar } from '../ui'
import '../features/compare.css'

const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const
const SPEEDS = [6, 12, 24, 72]

function shortName(name: string): string {
  return name.split(' · ')[0]
}

export function CompareScreen() {
  const audience = useStore((s) => s.audience)
  const sites = useStore((s) => s.compareSites)
  const storedRuns = useStore((s) => s.compareRuns)
  const view = useStore((s) => s.compareView)
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const offset = useStore((s) => s.cursorOffsetMs)
  const span = useStore(durationMs)
  const A = useStore((s) => s.scenarios.A.input)
  const durationDays = useStore((s) => s.durationDays)
  const stepMinutes = useStore((s) => s.stepMinutes)
  const azimuthStepDeg = useStore(s => s.azimuthStepDeg)
  const maxDistanceKm = useStore(s => s.maxDistanceKm)
  const mode = useStore(s => s.experiment.mode ?? 'sites')
  const paired = audience === 'educator' && mode !== 'sites'
  const runs = useMemo(() => Object.fromEntries(sites.map(c => [c.key,
    storedRuns[c.key]?.runKey === comparisonKey(c, { startMs: A.startMs, observerHeightM: A.observerHeightM, durationDays, stepMinutes, azimuthStepDeg, maxDistanceKm }) ? storedRuns[c.key] : undefined,
  ]).filter(([, run]) => run)) as Record<string, ScenarioRun>,
  [storedRuns, sites, A.startMs, A.observerHeightM, durationDays, stepMinutes, azimuthStepDeg, maxDistanceKm])
  usePlayback(playing)

  // (Re)start runs when the set of sites or the period changes.
  useEffect(() => {
    syncCompareRuns()
  }, [sites, A.startMs, A.observerHeightM, durationDays, stepMinutes, azimuthStepDeg, maxDistanceKm])

  const startMs = A.startMs

  // One vertical scale for every full-circle window.
  const scale = useMemo(() => {
    let lo = -2
    let hi = 6
    for (const c of sites) {
      const p = runs[c.key]?.terrain?.profile
      if (!p) continue
      lo = Math.min(lo, Math.floor(Math.min(...p.elevationDeg) - 0.5))
      hi = Math.max(hi, Math.ceil(Math.max(...p.elevationDeg) + 2))
    }
    return { lo, hi }
  }, [sites, runs])
  const facingAz = (sites[0]?.site.latDeg ?? -1) < 0 ? 0 : 180

  if (sites.length < 2) {
    return (
      <div className="site-page hc-page">
        <TopBar start={<CompareTitle count={sites.length} startMs={startMs} days={durationDays} />} />
        <div className="ui-card hc-empty">
          <h2 className="ui-title">Pick at least two sites to compare</h2>
          <p className="ui-muted">Their horizons play side by side on one clock, so you can see which one keeps the Sun and Earth in view.</p>
          <div>
            <Button
              onClick={() => {
                if (!getState().compareSites.length) setState({ compareSites: [currentCompareSite()] })
                openComparePicker()
              }}
            >
              Choose sites
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const pixelSizes = [...new Set(sites.map((c) => runs[c.key]?.terrain?.profile.dem.effectivePixelSizeM).filter((v): v is number => v !== undefined))]

  return (
    <div className="site-page hc-page" data-n={sites.length}>
      <TopBar start={<CompareTitle count={sites.length} startMs={startMs} days={durationDays} />}>
        <Button variant="secondary" size="s" icon={<Pencil {...ICON} />} onClick={() => paired ? goTo('moon') : openComparePicker()}>
          {paired ? 'Change the selected site' : 'Edit sites'}
        </Button>
      </TopBar>

      {audience === 'educator' && <ExperimentBar />}

      <div className="hc-stage">
        <div className="hc-grid" data-n={sites.length}>
          {sites.map((c, i) => (
            <ComparePanel
              key={c.key}
              letter={SLOT_LETTERS[i]}
              entry={c}
              run={runs[c.key]}
              cursorMs={slotCursor(c, startMs, offset)}
              audience={audience}
              view={view}
              scale={scale}
              facingAz={facingAz}
              startMs={slotStart(c, startMs)}
              spanMs={span}
              paired={paired}
              datesMode={paired && mode === 'dates'}
            />
          ))}
        </div>
        <p className="hc-scale-note ui-muted">
          {view === 'circle'
            ? `Full circle, ${facingAz === 0 ? 'north' : 'south'} in the middle, one height scale for every window. Heights are stretched; the Sun and Earth are drawn larger than life.`
            : 'Each window faces its own Sun. Sun, Earth and hills at true proportions.'}
        </p>

        <section className="ui-card is-tight hc-player" aria-label="Clock and period">
          <div className="hc-controls">
            <IconButton size="s" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setState({ playing: !playing })}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
            <div className="hc-when">
              <b className="mono">{paired && mode === 'dates' ? `Day ${Math.floor(offset / 86400000) + 1} · ${Math.floor(offset / 3600000) % 24}:00 elapsed` : `${formatUtc(startMs + offset)} UTC`}</b>
              <span className="ui-muted">{paired && mode === 'dates' ? 'Same elapsed time in both periods · drag the bars to move' : 'Same instant at every site · drag the bars to move'}</span>
            </div>
            <div className="hc-controls-end">
              {audience === 'planner' && (
                <label>
                  <span className="sr-only">Playback speed</span>
                  <Select inputSize="s" value={speed} onChange={(e) => setState({ speed: Number(e.target.value) })}>
                    {SPEEDS.map((v) => (
                      <option key={v} value={v}>
                        {v} h per second
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <Segmented<CompareView>
                label="View"
                size="s"
                value={view}
                onChange={(v) => setState({ compareView: v })}
                options={[
                  { value: 'circle', label: 'Full circle', title: 'All around, same scale in every window' },
                  { value: 'sun', label: 'Follow the Sun', title: 'Each window faces its own Sun, true proportions' },
                ]}
              />
            </div>
          </div>
          <SharedTimeline sites={sites} runs={runs} startMs={startMs} spanMs={span} offset={offset} audience={audience} />
        </section>
      </div>

      {audience !== 'public' && <NumbersTable sites={sites} runs={runs} startMs={startMs} spanMs={span} />}
      {audience === 'educator' && <LearningSummary sites={sites} runs={runs} startMs={startMs} spanMs={span} />}
      {pixelSizes.length > 0 && (
        <p className="hc-footnote ui-muted">
          Terrain sampled every {pixelSizes.map((m) => `${Math.round(m)} m`).join(' or ')}. Narrow ridges and small obstacles may be missing.
        </p>
      )}
    </div>
  )
}

function CompareTitle({ count, startMs, days }: { count: number; startMs: number; days: number }) {
  const back = currentCompareSite()
  const educator = useStore((s) => s.audience === 'educator')
  const mode = useStore(s => s.experiment.mode ?? 'sites')
  return (
    <div className="site-title">
      <BackLink label={educator ? 'Back to experiments' : `Back to ${shortName(back.name)}`} onClick={() => goTo(educator ? 'moon' : 'site')} />
      <div className="site-title-text">
        <h1 className="ui-title is-m">{educator && mode === 'dates' ? 'One site, two dates' : educator && mode === 'terrain' ? 'The effect of terrain' : count >= 2 ? `Comparing ${count} sites` : 'Compare horizons'}</h1>
        <span className="ui-small ui-muted">
          {educator && mode === 'dates' ? `${days} days in each period · UTC dates shown per window` : `${formatUtcDate(startMs)} – ${formatUtcDate(startMs + days * 86_400_000)}`}
        </span>
      </div>
    </div>
  )
}

interface PanelProps {
  letter: string
  entry: CompareSite
  run: ScenarioRun | undefined
  cursorMs: number
  audience: Audience
  view: CompareView
  scale: { lo: number; hi: number }
  facingAz: number
  startMs: number
  spanMs: number
  paired: boolean
  datesMode: boolean
}

function ComparePanel({ letter, entry, run, cursorMs, audience, view, scale, facingAz, startMs, spanMs, paired, datesMode }: PanelProps) {
  const experimentTrails = useStore((s) => s.experiment.trails)
  const flat = entry.horizonMode === 'ideal'
  const trails = audience === 'planner' || (audience === 'educator' && experimentTrails)
  const phase = run?.phase ?? 'idle'
  const terrain = run?.terrain
  const evaluation = run?.phase === 'ready' && !run.stale ? run.evaluation : undefined
  const previous = run?.previous
  const busy = !evaluation && phase !== 'error'

  const now = useMemo(() => (evaluation ? summarize(evaluation, startMs, startMs + spanMs) : null), [evaluation, startMs, spanMs])
  const prev = useMemo(() => (previous ? summarize(previous, startMs - spanMs, startMs) : null), [previous, startMs, spanMs])

  const remove = () => setState((s) => ({ compareSites: s.compareSites.filter((x) => x.key !== entry.key) }))
  const open = () => {
    setScenarioInput('A', { site: entry.site, siteName: entry.name, startMs })
    goTo('site')
  }
  const detail = datesMode
    ? `${formatUtc(cursorMs)} UTC`
    : flat
      ? 'Ideal 0° horizon'
      : terrain?.origin === 'demo'
        ? 'Practice terrain'
        : `${formatLat(entry.site.latDeg, 2)} ${formatLon(entry.site.lonEastDeg, 2)}`

  return (
    <article className="hc-tile" aria-label={`${letter}: ${entry.name}`}>
      <div className="hc-tile-in">
        <SpaceWindow className="hc-window">
          {phase === 'error' && !evaluation ? (
            <div className="hc-window-error">
              <Notice tone="danger">
                <strong>We could not calculate this site.</strong> {run?.error}{' '}
                <Button size="s" variant="inverse" onClick={() => retryCompareSite(entry)}>
                  Try again
                </Button>
              </Notice>
            </div>
          ) : (
            <Pending
              ready={!busy}
              bare
              tone="dark"
              note={run?.message || (phase === 'ephemeris' ? 'Tracking the Sun and Earth…' : 'Tracing the hills around the site…')}
              className="hc-building"
            >
              {terrain && evaluation && (
                <CompareWindow profile={flat ? flatProfile(terrain.profile) : terrain.profile} evaluation={evaluation} cursorMs={cursorMs} audience={audience} view={view} scale={scale} facingAz={facingAz} trails={trails} />
              )}
            </Pending>
          )}
          <div className="hc-tag" title={entry.name}>
            <span className="hc-badge">{letter}</span>
            <b>{shortName(entry.name)}</b>
            <span className="hc-tag-detail">{detail}</span>
          </div>
          <div className="hc-tools">
            {!flat && (
              <button type="button" className="hc-dark-btn" onClick={open} title="Open this site" aria-label={`Open ${entry.name}`}>
                <Maximize2 {...ICON} />
              </button>
            )}
            {!paired && (
              <button type="button" className="hc-dark-btn" onClick={remove} title="Remove from comparison" aria-label={`Remove ${entry.name}`}>
                <X {...ICON} />
              </button>
            )}
          </div>
        </SpaceWindow>

        <div className="hc-side">
          <PanelStatus evaluation={evaluation} cursorMs={cursorMs} audience={audience} aboveEl={view === 'circle' ? scale.hi : Infinity} />
          <PanelMetrics now={now} prev={prev} startMs={startMs} />
        </div>
      </div>
    </article>
  )
}

function PanelStatus({ evaluation, cursorMs, audience, aboveEl }: { evaluation: ScenarioRun['evaluation'] | undefined; cursorMs: number; audience: Audience; aboveEl: number }) {
  if (!evaluation) {
    return (
      <div className="hc-status" aria-hidden="true">
        <Chip tone="off">Waiting for the result</Chip>
      </div>
    )
  }
  const sun = bodyAt(evaluation, evaluation.sun, evaluation.intervals.sun, cursorMs)
  const earth = bodyAt(evaluation, evaluation.earth, evaluation.intervals.earth, cursorMs)
  const planner = audience === 'planner'
  const chip = (name: string, b: typeof sun, tone: 'sun' | 'earth') => {
    const word = b.visible ? `${name} in view` : b.elevationDeg > 0 ? `${name} behind hills` : `${name} below horizon`
    const above = b.visible && b.elevationDeg > aboveEl
    const extra = planner ? ` · ${formatAngle(b.elevationDeg, 2)}` : above ? ` · ${Math.round(b.elevationDeg)}° up` : ''
    return (
      <Chip tone={b.visible ? tone : 'off'} dot title={planner ? `Elevation ${formatAngle(b.elevationDeg, 2)}, azimuth ${Math.round(b.azimuthDeg)}°, ridge ${formatAngle(b.horizonDeg, 2)}` : undefined}>
        {word}
        {extra && <span className={planner && !above ? 'hc-chip-val' : undefined}>{extra}</span>}
        {above && <ArrowUp size={16} strokeWidth={1.75} aria-label="above this view" />}
      </Chip>
    )
  }
  return (
    <div className="hc-status">
      {chip('Sun', sun, 'sun')}
      {chip('Earth', earth, 'earth')}
    </div>
  )
}

interface Row {
  label: string
  get: (s: SiteSummary) => number | undefined
  format: (v: number) => string
  unit: string
  better: 'higher' | 'lower'
}

const pct = (v: number) => Math.round(v * 100)
const ROWS: Record<string, Row> = {
  sun: { label: 'Sunlit', get: (s) => pct(s.sun), format: (v) => `${v}%`, unit: '', better: 'higher' },
  earth: { label: 'Earth in view', get: (s) => pct(s.earth), format: (v) => `${v}%`, unit: '', better: 'higher' },
  both: { label: 'Sun and Earth', get: (s) => pct(s.both), format: (v) => `${v}%`, unit: '', better: 'higher' },
  night: { label: 'Longest night', get: (s) => Math.round(s.nightH), format: (v) => `${v} h`, unit: ' h', better: 'lower' },
  outage: { label: 'Longest time without Earth', get: (s) => s.earthOutageH, format: (v) => `${v.toFixed(1)} h`, unit: ' h', better: 'lower' },
  joint: { label: 'Longest shared window', get: (s) => s.jointWindowH, format: (v) => `${v.toFixed(1)} h`, unit: ' h', better: 'higher' },
}

function PanelMetrics({ now, prev, startMs }: { now: SiteSummary | null; prev: SiteSummary | null; startMs: number }) {
  const vs = `vs ${previousMonthName(startMs)}`
  const rows = [ROWS.sun, ROWS.earth]
  return (
    <dl className="hc-nums" data-count={rows.length}>
      {rows.map((r) => {
        const v = now ? r.get(now) : undefined
        const p = prev ? r.get(prev) : undefined
        return (
          <div key={r.label} className="ui-metric">
            <dt className="ui-metric-label">{r.label}</dt>
            <dd className="ui-metric-value">
              {v === undefined ? <span className="ui-muted">–</span> : r.format(v)}
              {v !== undefined && p !== undefined && <Delta value={v - p} unit={r.unit} better={r.better} suffix={vs} />}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/** Every number, one column per site, the best one in bold. */
function NumbersTable({ sites, runs, startMs, spanMs }: { sites: CompareSite[]; runs: Record<string, ScenarioRun>; startMs: number; spanMs: number }) {
  const audience = useStore((s) => s.audience)
  const summaries = sites.map((c) => {
    const run = runs[c.key]
    const from = slotStart(c, startMs)
    const ev = run?.phase === 'ready' && !run.stale ? run.evaluation : undefined
    return {
      now: ev ? summarize(ev, from, from + spanMs) : null,
      prev: run?.previous ? summarize(run.previous, from - spanMs, from) : null,
    }
  })
  const rows = Object.values(ROWS)
  const vs = `vs ${previousMonthName(startMs)}`
  return (
    <section className="ui-card hc-table-card" aria-labelledby="hc-table-title">
      <h2 className="ui-title" id="hc-table-title">
        All numbers for the period
      </h2>
      <div className="hc-table-wrap">
        <table className="hc-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              {sites.map((c, i) => (
                <th key={c.key} scope="col">
                  <span className="hc-badge is-light">{SLOT_LETTERS[i]}</span>
                  <span className="hc-table-site" title={c.name}>
                    {shortName(c.name)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const values = summaries.map((s) => (s.now ? r.get(s.now) : undefined))
              const known = values.filter((v): v is number => v !== undefined)
              const best = known.length > 1 && new Set(known).size > 1 ? (r.better === 'higher' ? Math.max(...known) : Math.min(...known)) : undefined
              return (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {values.map((v, i) => {
                    const p = summaries[i].prev ? r.get(summaries[i].prev!) : undefined
                    return (
                      <td key={sites[i].key} className={v !== undefined && v === best ? 'is-best' : undefined}>
                        {v === undefined ? <span className="ui-muted">{summaries[i].now ? 'Unknown' : '–'}</span> : r.format(v)}
                        {v !== undefined && p !== undefined && <Delta value={v - p} unit={r.unit} better={r.better} suffix={audience === 'planner' ? vs : undefined} />}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="ui-muted hc-table-note">Bold marks the best site on each line. The small number is the change {vs}.</p>
    </section>
  )
}

interface TimelineProps {
  sites: CompareSite[]
  runs: Record<string, ScenarioRun>
  startMs: number
  spanMs: number
  offset: number
  audience: Audience
}

function SharedTimeline({ sites, runs, startMs, spanMs, offset, audience }: TimelineProps) {
  const days = spanMs / 86_400_000
  const ticks = useMemo(() => {
    const every = days <= 14 ? 1 : days <= 30 ? 5 : 10
    const out: number[] = []
    for (let d = 0; d < days; d += every) out.push(d)
    return out
  }, [days])

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setState({ cursorOffsetMs: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * spanMs })
  }
  const step = (hours: number) => {
    const s = getState()
    setState({ cursorOffsetMs: Math.max(0, Math.min(spanMs, s.cursorOffsetMs + hours * 3_600_000)) })
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') step(e.shiftKey ? 24 : 1)
    else if (e.key === 'ArrowLeft') step(e.shiftKey ? -24 : -1)
    else if (e.key === 'Home') setState({ cursorOffsetMs: 0 })
    else return
    e.preventDefault()
  }

  return (
    <div className="hc-timeline-body">
        <div className="hc-timeline-labels" aria-hidden="true">
          {sites.map((c, i) => (
            <span key={c.key} className="hc-timeline-label">
              <span className="hc-badge is-light">{SLOT_LETTERS[i]}</span>
              <span className="hc-timeline-name">{shortName(c.name)}</span>
            </span>
          ))}
          <span className="hc-legend">
            <span><i className="is-sun" />Sun</span>
            <span><i className="is-earth" />Earth</span>
          </span>
        </div>
        <div
          className="hc-timeline-bars"
          role="slider"
          tabIndex={0}
          aria-label="Time in the period"
          aria-valuemin={0}
          aria-valuemax={Math.round(spanMs / 3_600_000)}
          aria-valuenow={Math.round(offset / 3_600_000)}
          aria-valuetext={sites.map((c, i) => `${SLOT_LETTERS[i]}: ${formatUtcLong(slotCursor(c, startMs, offset))}`).join('; ')}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            setState({ playing: false })
            scrub(e)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e)
          }}
        >
          {sites.map((c) => {
            const ev = runs[c.key]?.evaluation
            const from = slotStart(c, startMs)
            return (
              <div key={c.key} className="hc-timeline-row">
                <TrackBar tone="sun" size="s" intervals={ev?.intervals.sun ?? []} startMs={from} spanMs={spanMs} label={`${c.name}: Sun in view`} />
                <TrackBar tone="earth" size="s" intervals={ev?.intervals.earth ?? []} startMs={from} spanMs={spanMs} label={`${c.name}: Earth in view`} />
              </div>
            )
          })}
          <div className="timeline-axis" aria-hidden="true">
            {ticks.map((d) => (
              <span key={d} style={{ left: `${(d / days) * 100}%` }}>
                {audience === 'planner' ? formatUtcDate(startMs + d * 86_400_000) : `Day ${d + 1}`}
              </span>
            ))}
          </div>
          <span className="timeline-cursor" style={{ left: `${(offset / spanMs) * 100}%` }} aria-hidden="true" />
        </div>
      </div>
  )
}


function LearningSummary({ sites, runs, startMs, spanMs }: { sites: CompareSite[]; runs: Record<string, ScenarioRun>; startMs: number; spanMs: number }) {
  const evaluations = sites.map(c => runs[c.key]?.evaluation)
  const ready = evaluations.every(Boolean)
  const baseline = evaluations[0]
  const compatible = ready && evaluations.every(ev => ev?.origin === baseline?.origin && ev?.visibilityModel === baseline?.visibilityModel && ev?.ephemeris.version === baseline?.ephemeris.version)
  return <section className="ui-card" aria-label="Explain the observations">
    <h2 className="ui-title">Explain: what changed, and what did it cost?</h2>
    {!ready ? <p className="ui-small ui-muted">Wait for every result before drawing conclusions. Missing measurements are not zero visibility.</p>
      : !compatible ? <Notice>These results use different visibility models or sources. They cannot establish a controlled comparison.</Notice>
      : <>
        <p className="ui-small ui-muted">{baseline?.origin === 'demo' ? 'Practice simulation with synthetic terrain. ' : ''}These observations describe visibility, not landing safety, battery autonomy or a guaranteed radio link.</p>
        {sites.slice(1).map((c, i) => {
          const first = summarize(baseline!, slotStart(sites[0], startMs), slotStart(sites[0], startMs) + spanMs)
          const from = slotStart(c, startMs)
          const other = summarize(evaluations[i + 1]!, from, from + spanMs)
          const changes = decisionChanges(other, first)
          const mixed = changes.some(d => d.outcome === 'improved') && changes.some(d => d.outcome === 'worsened')
          return <div key={c.key}>
            <h3 className="ui-title">{SLOT_LETTERS[i + 1]} compared with A</h3>
            <ul className="ui-small">{changes.map(d => <li key={d.key}>{d.label}: {Math.abs(d.delta) < .05 ? 'unchanged' : `${d.delta > 0 ? '+' : ''}${d.delta.toFixed(1)} ${d.unit}`}</li>)}</ul>
            <p className="ui-small">{mixed ? 'A trade-off appears: some visibility measures improve while others worsen. Which matters most for your mission?' : 'Which observation supports your prediction? Would a different date or a different mission need change the choice?'}</p>
          </div>
        })}
        <details className="ui-small"><summary>Connect the observation to a mission</summary>
          <p>Sunlight gives opportunities for solar generation. Earth visibility permits a geometric direct path. Shared windows allow both together. Long interruptions create storage or relay needs that require separate equipment models. Use the timeline to find the moments that explain the totals.</p>
        </details>
      </>}
  </section>
}
