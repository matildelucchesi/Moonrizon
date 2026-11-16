import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { Play } from 'lucide-react'
import { Stars, TryButton, Words } from './bits'
import { useReducedMotion, useSize, useTrackProgress } from './hooks'
import { DAYS, STATE_TEXT, TIMELINE, U_START, earthAt, foreground, isVisible, ridgeDeg, skyState, sunAt } from './model'

const mid = foreground(23)
const near = foreground(37)
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}°`
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Time that passes by itself on arrival, so the scene is never a still. */
function useIntro(): number {
  const reduced = useReducedMotion()
  const [skip] = useState(() => reduced || window.scrollY > 8)
  const [t, setT] = useState(skip ? 1 : 0)
  useEffect(() => {
    if (skip) return
    let raf = 0
    const start = performance.now() + 500
    const step = (now: number) => {
      const x = Math.min(1, Math.max(0, (now - start) / 2600))
      setT(easeInOut(x))
      if (x < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [skip])
  return t
}

/** Stage geometry in real pixels; `k` is one design pixel (1440 x 900, or 390 x 844 upright). */
function useGeometry(w: number, h: number, timelineTop: number) {
  return useMemo(() => {
    const upright = w / h < 0.8
    const k = upright ? Math.min(w / 390, h / 844) : Math.min(w / 1440, h / 900)
    // The flat horizon sits just above the docked timeline, whatever its height.
    const y0 = (timelineTop > 0 ? timelineTop : h - 180 * k) - 16 * k
    const deg = (upright ? 30 : 45) * k
    const ax = (a: number) => (upright ? w * (0.06 + 0.88 * a) : w * (0.5 + 0.46 * a))
    const xa = (x: number) => (upright ? (x / w - 0.06) / 0.88 : (x / w - 0.5) / 0.46)
    const ey = (el: number) => y0 - el * deg
    const layer = (y: (a: number) => number) => {
      const pts: string[] = []
      for (let x = -24; x <= w + 24; x += 8) pts.push(`${x},${y(xa(x)).toFixed(1)}`)
      return `M-24,${h} L${pts.join(' L')} L${w + 24},${h} Z`
    }
    return {
      upright,
      k,
      y0,
      ax,
      ey,
      far: layer((a) => ey(ridgeDeg(a))),
      mid: layer((a) => y0 + (upright ? 44 : 40) * k - 28 * k * mid(a)),
      near: layer((a) => y0 + (upright ? 96 : 110) * k - 22 * k * near(a)),
      sunR: (upright ? 20 : 30) * k,
      earthR: (upright ? 28 : 40) * k,
    }
  }, [w, h, timelineTop])
}

interface Chapter {
  until: number
  lines: { text: string; accent?: 'sun' | 'earth' | 'quiet' }[][]
  body?: string
  action?: boolean
}

/** What the sky says as the month goes by; `until` is in days. */
const CHAPTERS: Chapter[] = [
  { until: 6.5, lines: [], action: true },
  {
    until: 12,
    lines: [[{ text: 'The Sun skims the hills and hides' }, { text: 'for days.', accent: 'sun' }]],
    body: 'Near the south pole the Sun never climbs high. One hill is enough to leave a site in the dark.',
  },
  {
    until: 16,
    lines: [[{ text: 'Earth', accent: 'earth' }, { text: 'drops out of view.' }], [{ text: 'No light. No radio.', accent: 'quiet' }]],
    body: 'Without a clear line to Earth, a lander cannot call home.',
  },
  {
    until: 19.5,
    lines: [[{ text: 'Where? When? How long?' }]],
    body: 'Every site has its own answer, because every site has its own horizon.',
  },
  {
    until: 25,
    lines: [[{ text: 'Stand on the horizon.' }]],
    body: "Moonrizon draws each site's ridge from NASA terrain and places the Sun and the Earth where they really are, for the dates you choose.",
  },
  {
    until: Infinity,
    lines: [[{ text: 'Find your window.' }]],
    body: 'Sun and Earth up together: power, and a link home.',
    action: true,
  },
]

function ChapterText({ index, onFilm }: { index: number; onFilm: () => void }) {
  const chapter = CHAPTERS[index]
  if (index === 0) {
    return (
      <div className="lp-chapter lp-hero" key="hero">
        <h1 className="lp-display lp-h1">
          <Words text="Before you land," />
          <br />
          <Words text="look up." from={3} />
        </h1>
        <p className="lp-lede lp-rise" style={{ '--i': 6 } as CSSProperties}>
          Scroll through one month at the Moon's south pole and watch the Sun and the Earth slip behind the ridge.<span className="lp-wide-only"> Moonrizon shows it for real landing sites, from NASA data.</span>
        </p>
        <div className="lp-actions lp-rise" style={{ '--i': 8 } as CSSProperties}>
          <TryButton />
          <button type="button" className="lp-film-link" onClick={onFilm}>
            <Play aria-hidden="true" />
            Watch the 44-second film
          </button>
        </div>
      </div>
    )
  }
  const counts = chapter.lines.map((line) => line.map((piece) => piece.text.split(' ').length))
  const before = (li: number, pi: number) => counts.flatMap((line, l) => line.filter((_, q) => l < li || (l === li && q < pi))).reduce((sum, c) => sum + c, 0)
  const n = before(counts.length, 0)
  return (
    <div className="lp-chapter" key={index}>
      <h2 className="lp-display lp-h2">
        {chapter.lines.map((line, li) => (
          <span className="lp-line" key={li}>
            {line.map((piece, pi) => (
              <Words key={pi} text={piece.text} from={before(li, pi)} accent={piece.accent} />
            ))}
          </span>
        ))}
      </h2>
      {chapter.body && (
        <p className="lp-lede lp-rise" style={{ '--i': n + 1 } as CSSProperties}>
          {chapter.body}
        </p>
      )}
      {chapter.action && (
        <div className="lp-actions lp-rise" style={{ '--i': n + 3 } as CSSProperties}>
          <TryButton />
        </div>
      )}
    </div>
  )
}

function Timeline({ u, onScrub, innerRef }: { u: number; onScrub: (u: number) => void; innerRef: RefObject<HTMLDivElement | null> }) {
  const tracks = useRef<HTMLDivElement>(null)
  const day = u * DAYS
  const seek = (e: PointerEvent) => {
    const rect = tracks.current!.getBoundingClientRect()
    onScrub((e.clientX - rect.left) / rect.width)
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!step) return
    e.preventDefault()
    onScrub((day + step) / DAYS)
  }
  return (
    <div className="lp-timeline" ref={innerRef}>
      <p className="lp-timeline-now">
        day {day.toFixed(1)} of {DAYS} · {STATE_TEXT[skyState(u)]}
      </p>
      <div className="lp-timeline-grid">
        <div className="lp-timeline-labels">
          {TIMELINE.map((row) => (
            <span key={row.id}>{row.label}</span>
          ))}
        </div>
        <div
          className="lp-timeline-tracks"
          ref={tracks}
          role="slider"
          tabIndex={0}
          aria-label="Day of the month"
          aria-valuemin={0}
          aria-valuemax={DAYS}
          aria-valuenow={Number(day.toFixed(1))}
          aria-valuetext={`day ${day.toFixed(1)} of ${DAYS}, ${STATE_TEXT[skyState(u)]}`}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            seek(e)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e)
          }}
        >
          {TIMELINE.map((row) => (
            <div className="lp-track" key={row.id} data-row={row.id}>
              {row.runs
                .filter(([from]) => from < u)
                .map(([from, to]) => (
                  <i key={from} style={{ left: `${from * 100}%`, width: `${(Math.min(to, u) - from) * 100}%` }} />
                ))}
            </div>
          ))}
          <i className="lp-playhead" style={{ left: `${u * 100}%` }} />
        </div>
        <span className="lp-timeline-hint">scroll = time</span>
        <div className="lp-timeline-ticks">
          {['day 1', '10', '20', '30'].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>
      <p className="lp-timeline-note">Illustrative month. The app uses real NASA terrain.</p>
    </div>
  )
}

export function HorizonStage({ onFilm }: { onFilm: () => void }) {
  const track = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const { p, scrollTo } = useTrackProgress(track)
  const intro = useIntro()
  const timeline = useRef<HTMLDivElement>(null)
  const { w, h } = useSize(stage)
  const timelineSize = useSize(timeline)
  const [timelineTop, setTimelineTop] = useState(0)
  useEffect(() => {
    setTimelineTop(timeline.current?.offsetTop ?? 0)
  }, [w, h, timelineSize.h])
  const g = useGeometry(w, h, timelineTop)

  const u = U_START * intro + p * (1 - U_START)
  const day = u * DAYS
  const sun = sunAt(u)
  const earth = earthAt(u)
  const sunUp = isVisible(sun)
  const earthUp = isVisible(earth)
  const state = skyState(u)
  const chapter = CHAPTERS.findIndex((c) => day < c.until)

  const trail = useMemo(() => {
    const pts: string[] = []
    for (let i = 0; i <= 90; i++) {
      const s = sunAt((u * i) / 90)
      pts.push(`${g.ax(s.a).toFixed(1)},${g.ey(s.el).toFixed(1)}`)
    }
    return pts.join(' ')
  }, [u, g])

  const sx = g.ax(sun.a)
  const sy = g.ey(sun.el)
  const ex = g.ax(earth.a)
  const ey = g.ey(earth.el)
  const er = g.earthR
  const label = Math.max(13, 14 * g.k)

  return (
    <section className="lp-month" ref={track} data-band="dark" aria-label="One month on the lunar horizon">
      <div className="lp-stage" ref={stage} data-sun={sunUp ? 'up' : 'down'}>
        <div className="lp-sky" style={{ transform: `translateX(${(-u * 24).toFixed(1)}px)` }}>
          <Stars />
        </div>
        <div className="lp-night" />
        <svg className="lp-scene" width={w} height={h} aria-hidden="true">
          <polyline className="lp-trail" points={trail} />
          <circle className="lp-body-sun" cx={sx} cy={sy} r={g.sunR} />
          <circle className="lp-body-earth" cx={ex} cy={ey} r={er} />
          <path className="lp-earth-night" d={`M${ex} ${ey - er} A${er} ${er} 0 0 1 ${ex} ${ey + er} A${er * 0.45} ${er} 0 0 0 ${ex} ${ey - er} Z`} />
          <path className="lp-rock-far" d={g.far} />
          <line className="lp-flat" x1={0} x2={w} y1={g.y0} y2={g.y0} />
          <path className="lp-rock-mid" d={g.mid} />
          <path className="lp-rock-near" d={g.near} />
          {sunUp && (
            <text className="lp-tag" x={sx} y={sy - g.sunR - 12 * g.k} fontSize={label} textAnchor="middle">
              Sun
            </text>
          )}
          {earthUp && (
            <text className="lp-tag" x={ex} y={ey - er - 12 * g.k} fontSize={label} textAnchor="middle">
              Earth
            </text>
          )}
          <text className="lp-tag" x={(g.upright ? 16 : 48) * g.k} y={g.y0 - 12 * g.k} fontSize={label}>
            flat horizon 0°
          </text>
        </svg>

        <div className="lp-copy" aria-live="polite">
          <ChapterText index={chapter} onFilm={onFilm} />
        </div>

        <dl className="lp-readout">
          <div className="lp-readout-day">
            <dt className="sr-only">Time</dt>
            <dd>
              day {day.toFixed(1)} of {DAYS}
            </dd>
          </div>
          <div>
            <dt className="lp-sun">Sun el</dt>
            <dd>{signed(sun.el)}</dd>
          </div>
          <div>
            <dt className="lp-earth">Earth el</dt>
            <dd>{signed(earth.el)}</dd>
          </div>
          <div className="lp-readout-state" data-state={state}>
            <dt className="sr-only">State</dt>
            <dd>{STATE_TEXT[state]}</dd>
          </div>
        </dl>

        <Timeline u={u} innerRef={timeline} onScrub={(target) => scrollTo((target - U_START) / (1 - U_START))} />
      </div>
    </section>
  )
}
