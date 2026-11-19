/**
 * Step 4: the view from the site, then the evidence grouped by question.
 * One 12-column grid; cards in a row share their height. Every card is on the
 * page from the first frame, with its title, and its content arrives when the
 * calculation it depends on has finished.
 */
import { Columns2, Maximize2, Minimize2, Orbit, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { formatLat, formatLon, formatUtcLong } from '../domain/format'
import { CUSTOM_SITE_NAME } from '../domain/sites'
import { PublicAssessment } from '../features/PublicAssessment'
import { Scorecard } from '../features/Scorecard'
import { CompareCard, DayHourCard, EventsCard, LightCalendarCard, WindowsCard } from '../features/DeepDive'
import { openComparePicker } from '../features/compareSlots'
import { EclipseStrip, NextEclipseCard } from '../features/EclipseCards'
import { HorizonScene } from '../features/HorizonScene'
import { OrbitView } from '../features/OrbitView'
import { DataPanel, MonthPanel, NowPanel, PeriodPanel, PromptsPanel } from '../features/Report'
import { RunSteps, STEPS_DONE } from '../features/RunSteps'
import { Timeline } from '../features/Timeline'
import { TopBar } from '../features/TopBar'
import { runScenario } from '../state/runner'
import { goTo, useStore, type Audience, type RunPhase, type ScenarioRun } from '../state/store'
import { BackLink, Button, Notice, Pending, SpaceWindow } from '../ui'

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const

/** What the engine is doing, in plain words, for when it has sent no message yet. */
function phaseText(phase: RunPhase): string {
  if (phase === 'ready') return 'Comparing with the month before…'
  return phase === 'ephemeris' ? 'Tracking the Sun and Earth…' : 'Tracing the hills around the site…'
}

/**
 * Which of the three jobs is running: the terrain, the Sun and Earth, then the
 * period before (which starts once the page is usable). STEPS_DONE when none is.
 */
function stepOf(run: ScenarioRun): number {
  if (run.phase === 'idle' || run.phase === 'terrain') return 0
  if (run.phase === 'ephemeris') return 1
  return run.phase === 'ready' && run.previousState === 'pending' ? 2 : STEPS_DONE
}

type Span = 3 | 4 | 6 | 8 | 12

interface Cell {
  key: string
  span: Span
  node: ReactNode
  /** The card's own title, shown while it waits for its data. */
  title: string
  /** Height to hold while the card waits for its data. */
  rest: number
}

interface Section {
  key: string
  title: string
  cells: Cell[]
}

/** Which cards each reader gets, grouped by the question they answer. */
function sectionsFor(audience: Audience): Section[] {
  if (audience === 'public') {
    return [{ key: 'why', title: 'Right now and over the month', cells: [
      { key: 'result', span: 4, title: 'Your result', rest: 320, node: <Scorecard /> },
      { key: 'calendar', span: 4, title: 'Light calendar', rest: 320, node: <LightCalendarCard audience="public" /> },
      { key: 'characteristics', span: 4, title: 'The selected period in numbers', rest: 320, node: <MonthPanel /> },
    ] }]
  }

  if (audience === 'educator') {
    return [
      { key: 'explain', title: 'Why is this site more or less favorable?', cells: [
        { key: 'assessment', span: 12, title: 'Why this site?', rest: 240, node: <PublicAssessment /> },
        { key: 'comparison', span: 12, title: 'Compared with the best sites', rest: 480, node: <CompareCard audience="educator" /> },
        { key: 'numbers', span: 6, title: 'The selected period in numbers', rest: 320, node: <MonthPanel /> },
        { key: 'prompts', span: 6, title: 'For the class', rest: 320, node: <PromptsPanel /> },
      ] },
      { key: 'demonstrate', title: 'Demonstrate how conditions change', cells: [
        { key: 'calendar', span: 12, title: 'Light calendar', rest: 320, node: <LightCalendarCard audience="educator" /> },
        { key: 'windows', span: 12, title: 'Best windows to land', rest: 240, node: <WindowsCard audience="educator" /> },
        { key: 'eclipses', span: 12, title: 'Eclipses from this site', rest: 240, node: <EclipseStrip audience="educator" /> },
      ] },
    ]
  }

  return [
    {
      key: 'choose',
      title: 'Decision',
      cells: [
        // The comparison first; the period table after it, across the whole row.
        { key: 'cmp', span: 12, title: 'Compared with the best sites', rest: 480, node: <CompareCard audience="planner" /> },
        { key: 'period', span: 12, title: 'This period', rest: 480, node: <PeriodPanel /> },
        { key: 'win', span: 12, title: 'Best windows to land', rest: 240, node: <WindowsCard audience="planner" /> },
      ],
    },
    { key: 'time', title: 'Light and link, hour by hour', cells: [{ key: 'heat', span: 12, title: 'Day by hour', rest: 280, node: <DayHourCard /> }] },
    {
      key: 'eclipse',
      title: 'Eclipses',
      cells: [
        { key: 'next', span: 4, title: 'Next eclipse', rest: 320, node: <NextEclipseCard audience="planner" /> },
        { key: 'strip', span: 8, title: 'Eclipses from this site', rest: 320, node: <EclipseStrip audience="planner" /> },
      ],
    },
    {
      key: 'data',
      title: 'Events and data',
      cells: [
        { key: 'events', span: 6, title: 'Events', rest: 320, node: <EventsCard /> },
        { key: 'data', span: 6, title: 'Data and caveats', rest: 320, node: <DataPanel /> },
      ],
    },
  ]
}

export function SiteScreen() {
  const audience = useStore((s) => s.audience)
  const A = useStore((s) => s.scenarios.A)
  const offset = useStore((s) => s.cursorOffsetMs)
  const { terrain, evaluation, phase, error } = A.run
  const busy = phase === 'idle' || phase === 'terrain' || phase === 'ephemeris'
  // Results from before the inputs changed stay on screen, dimmed, until the new ones arrive.
  const dim = !!evaluation && (busy || A.run.stale)
  const ready = !!evaluation
  const sections = sectionsFor(audience)
  const name = A.input.siteName ?? CUSTOM_SITE_NAME
  const [orbitsOpen, setOrbitsOpen] = useState(false)
  const [full, setFull] = useState(false)
  const horizon = useRef<HTMLDivElement>(null)
  const cursorMs = A.input.startMs + offset

  // Full screen for the horizon: the browser API where available, otherwise a fixed layer.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === horizon.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFull = async () => {
    const el = horizon.current
    if (!el) return
    if (document.fullscreenElement) return void (await document.exitFullscreen().catch(() => setFull(false)))
    if (full) return setFull(false)
    try {
      await el.requestFullscreen()
    } catch {
      setFull(true)
    }
  }

  return (
    <div className="site-page">
      <TopBar
        start={
          <div className="site-title">
            <BackLink
              label={audience === 'public' ? 'Pick another spot' : audience === 'educator' ? 'Back to the comparison' : 'Back to the shortlist'}
              onClick={() => goTo(audience === 'educator' ? 'compare' : 'moon')}
            />
            <div className="site-title-text">
              <h1 className="ui-title is-m">{name}</h1>
              <span className="ui-small ui-muted">
                {audience === 'planner'
                  ? `${formatLat(A.input.site.latDeg)} ${formatLon(A.input.site.lonEastDeg)} · start ${formatUtcLong(A.input.startMs)}`
                  : `From ${formatUtcLong(A.input.startMs)}`}
              </span>
            </div>
          </div>
        }
      >
        <Button variant="secondary" size="s" icon={<Columns2 size={18} strokeWidth={1.75} aria-hidden="true" />} onClick={openComparePicker}>
          Compare
        </Button>
      </TopBar>

      <div className="site-grid">
        <div ref={horizon} className={`site-horizon span-8${full ? ' is-full' : ''}${orbitsOpen ? ' has-orbits' : ''}`}>
          <SpaceWindow className="site-window" aria-label="View from the site">
            {phase === 'error' ? (
              <div className="site-loading"><Notice tone="danger"><strong>We could not calculate this scenario.</strong> {error}{' '}<Button size="s" variant="inverse" onClick={() => void runScenario('A')}>Try again</Button></Notice></div>
            ) : (
              <>
                {/* The hills draw as soon as the terrain is known; the Sun and Earth join when the evaluation arrives. */}
                {terrain && (
                  <div className={`site-building${dim ? ' is-dim' : ''}`} aria-busy={!ready}>
                    <HorizonScene profile={terrain.profile} evaluation={evaluation} cursorMs={cursorMs} audience={audience} />
                  </div>
                )}
                <RunSteps step={stepOf(A.run)} startedAt={A.run.startedAt} message={A.run.message || phaseText(phase)} belowControls={ready} />
              </>
            )}
            {!orbitsOpen && evaluation && (
              <button type="button" className={`orbit-mini ui-reveal${dim ? ' is-dim' : ''}`} style={{ '--i': 1 } as CSSProperties} onClick={() => setOrbitsOpen(true)} aria-label="Open the view of the Sun, Earth and Moon from outside">
                <OrbitView cursorMs={cursorMs} audience={audience} compact />
                <span className="orbit-mini-label">
                  <Orbit size={16} strokeWidth={1.75} aria-hidden="true" />
                  Orbits
                  <Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" />
                </span>
              </button>
            )}
            <button type="button" className="site-full" onClick={() => void toggleFull()} aria-label={full ? 'Leave full screen' : 'Full screen'} title={full ? 'Leave full screen' : 'Full screen'}>
              {full ? <Minimize2 {...ICON} /> : <Maximize2 {...ICON} />}
            </button>
          </SpaceWindow>
          {orbitsOpen && (
            <SpaceWindow className="site-orbits" aria-label="Sun, Earth and Moon from outside">
              <OrbitView cursorMs={cursorMs} audience={audience} />
              <button type="button" className="site-full" onClick={() => setOrbitsOpen(false)} aria-label="Close the orbit view" title="Close">
                <X {...ICON} />
              </button>
            </SpaceWindow>
          )}
        </div>

        <aside className="site-now span-4" aria-label="Right now">
          <Pending ready={ready} title={audience === 'planner' ? 'Now' : 'Right now'} minHeight={440} index={1} dim={dim} className="fill">
            <NowPanel audience={audience} />
          </Pending>
        </aside>

        <div className="span-12">
          <Pending ready={ready} title="Time" minHeight={224} index={2} dim={dim}>
            <Timeline audience={audience} />
          </Pending>
        </div>
      </div>

      {sections.map((section, si) => (
        <section key={section.key} className="site-section" aria-labelledby={`sec-${section.key}`}>
          <h2 className="ui-title is-m" id={`sec-${section.key}`}>
            {section.title}
          </h2>
          <div className="site-grid">
            {section.cells.map((c, ci) => (
              <div key={c.key} className={`span-${c.span}`}>
                <Pending ready={ready} title={c.title} minHeight={c.rest} index={3 + sections.slice(0, si).reduce((n, x) => n + x.cells.length, 0) + ci} dim={dim} className="fill">
                  {c.node}
                </Pending>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
