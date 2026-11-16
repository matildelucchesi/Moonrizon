import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Play } from 'lucide-react'
import { DomeCatBuild, Stars, TryButton, Words } from './bits'
import { useRamp, useReducedMotion, useSeen, useViewProgress } from './hooks'

const asset = (path: string) => `${import.meta.env.BASE_URL}landing/${path}`

/** A real app screenshot in a window, with a slow straight push as it crosses the screen. */
function Shot({ src, alt, origin = '50% 50%', eager = false }: { src: string; alt: string; origin?: string; eager?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useViewProgress(ref)
  return (
    <figure className="lp-shot" ref={ref}>
      <img src={asset(`shots/${src}.webp`)} alt={alt} width={1920} height={1080} loading={eager ? 'eager' : 'lazy'} decoding="async" style={{ transformOrigin: origin }} />
    </figure>
  )
}

const STEPS = [
  {
    title: 'Pick a place and a date.',
    body: 'Start from a 3D Moon built on NASA LRO imagery and LOLA terrain. Choose the day you arrive and how long you plan to stay.',
    src: 'home',
    alt: 'Moonrizon opening screen: a calendar next to a 3D Moon with Apollo sites and south pole regions marked.',
    origin: '62% 50%',
  },
  {
    title: 'See 29 sites ranked for your mission.',
    body: 'Sunlight, Earth in view and the longest dark stretch, measured for every catalog site, including the 13 Artemis candidate regions.',
    src: 'explore',
    alt: 'The south pole from above with numbered candidate regions and a ranked list of site cards.',
    origin: '90% 32%',
  },
  {
    title: 'Stand on the horizon.',
    body: 'Open a site and watch the Sun and the Earth move against its real ridge, hour by hour, with the month laid out underneath.',
    src: 'site',
    alt: 'The horizon view at Peak Near Shackleton: the Sun above the terrain horizon, readings on the right, a 30-day timeline below.',
    origin: '25% 75%',
  },
]

export function HowItWorks({ innerRef }: { innerRef: RefObject<HTMLElement | null> }) {
  return (
    <section className="lp-section lp-light" data-band="light" ref={innerRef}>
      <div className="lp-wrap">
        <h2 className="lp-display lp-title">From the whole Moon to one horizon.</h2>
        {STEPS.map((step) => (
          <article className="lp-step" key={step.src}>
            <div className="lp-step-text">
              <h3 className="lp-display lp-subtitle">{step.title}</h3>
              <p>{step.body}</p>
            </div>
            <Shot src={step.src} alt={step.alt} origin={step.origin} />
          </article>
        ))}
      </div>
    </section>
  )
}

const AUDIENCES = [
  {
    label: 'Mission Planner',
    src: 'site',
    alt: 'Mission Planner view with azimuth, elevation and margin for the Sun and the Earth.',
    body: 'Azimuth, elevation and margin to the terrain horizon, requirement checks, and up to four sites compared side by side.',
  },
  {
    label: 'Educator',
    src: 'site-educator',
    alt: 'Educator view: the Sun labelled 2.5 degrees above the hills, with sunset and earthrise dates.',
    body: 'The same scene in classroom words: degrees above the hills, sunset and earthrise dates, sized for a projector.',
  },
  {
    label: 'General Public',
    src: 'site-general-public',
    alt: 'General Public view: 30 days of sunlight left, no link for 2 days more.',
    body: 'Plain answers first: how many days of sunlight are left, and when the lander can call home.',
  },
]

export function Audiences({ innerRef }: { innerRef: RefObject<HTMLElement | null> }) {
  const [active, setActive] = useState(0)
  const [touched, setTouched] = useState(false)
  const reduced = useReducedMotion()
  const seen = useSeen(innerRef, 0.4)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const [thumb, setThumb] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabs.current[active]
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  // Cycles like the film until someone takes over.
  useEffect(() => {
    if (touched || reduced || !seen) return
    const id = setInterval(() => setActive((a) => (a + 1) % AUDIENCES.length), 3600)
    return () => clearInterval(id)
  }, [touched, reduced, seen])

  const pick = (i: number) => {
    setTouched(true)
    setActive(i)
  }

  return (
    <section className="lp-section lp-light lp-audiences" data-band="light" ref={innerRef}>
      <div className="lp-wrap">
        <div className="lp-audience-head">
          <h2 className="lp-display lp-title">
            One engine. <span className="lp-primary">Three audiences.</span>
          </h2>
          <div className="lp-switch" role="tablist" aria-label="Audience">
            <i className="lp-switch-thumb" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />
            {AUDIENCES.map((a, i) => (
              <button
                key={a.label}
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`lp-tab-${i}`}
                aria-selected={i === active}
                aria-controls="lp-audience-panel"
                tabIndex={i === active ? 0 : -1}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                  if (!step) return
                  const next = (i + step + AUDIENCES.length) % AUDIENCES.length
                  pick(next)
                  tabs.current[next]?.focus()
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div id="lp-audience-panel" role="tabpanel" aria-labelledby={`lp-tab-${active}`}>
          <p className="lp-audience-body" key={active}>
            {AUDIENCES[active].body}
          </p>
          <div className="lp-shot lp-shot-stack">
            {AUDIENCES.map((a, i) => (
              <img key={a.src} src={asset(`shots/${a.src}.webp`)} alt={i === active ? a.alt : ''} aria-hidden={i !== active} data-active={i === active} width={1920} height={1080} loading="lazy" decoding="async" />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Count({ run, to, decimals = 0, delay = 0 }: { run: boolean; to: number; decimals?: number; delay?: number }) {
  const t = useRamp(run, 900, delay)
  return <>{(to * t).toFixed(decimals)}</>
}

export function Numbers() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref, 0.5)
  const items: { tone: string; big: ReactNode; label: string }[] = [
    { tone: 'ink', big: <Count run={seen} to={720} />, label: 'terrain rays around every site' },
    { tone: 'primary', big: <><Count run={seen} to={30} delay={150} /> days</>, label: 'checked every 10 minutes' },
    { tone: 'earth', big: 'JPL', label: 'Horizons ephemerides for the Sun and the Earth' },
    { tone: 'sun', big: <Count run={seen} to={3} delay={450} />, label: 'audiences, one engine' },
  ]
  return (
    <section className="lp-section lp-light lp-numbers" data-band="light">
      <div className="lp-wrap">
        <h2 className="lp-display lp-title">
          Every number from <span className="lp-primary">real NASA terrain.</span>
        </h2>
        <div className="lp-number-row" ref={ref}>
          {items.map((it) => (
            <div className="lp-number" key={it.label} data-tone={it.tone}>
              <strong className="lp-display">{it.big}</strong>
              <span>{it.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Proof({ innerRef }: { innerRef: RefObject<HTMLElement | null> }) {
  const cards = useRef<HTMLDivElement>(null)
  const seen = useSeen(cards, 0.15)
  const items = [
    { tone: 'sun', big: <><Count run={seen} to={97.5} decimals={1} />%</>, label: 'slope agreement with NASA PGDA', sub: 'Malapert Massif, 118 of 121 points' },
    { tone: 'earth', big: <><Count run={seen} to={184} delay={200} />/184</>, label: 'backend tests pass', sub: '99 of them on the engine' },
    { tone: 'paper', big: <><Count run={seen} to={0.9} decimals={1} delay={400} /> s</>, label: 'same answer from cache', sub: '11.3 s on a first run' },
  ]
  return (
    <section className="lp-section lp-dark lp-proof" data-band="dark" ref={innerRef}>
      <Stars count={60} seed={9} />
      <div className="lp-wrap">
        <h2 className="lp-display lp-title">
          Checked, <span className="lp-quiet">not guessed.</span>
        </h2>
        <div className={seen ? 'lp-proof-row lp-seen' : 'lp-proof-row'} ref={cards}>
          {items.map((it, i) => (
            <div className="lp-proof-card" key={it.label} data-tone={it.tone} style={{ '--i': i } as CSSProperties}>
              <strong className="lp-display">{it.big}</strong>
              <b>{it.label}</b>
              <span>{it.sub}</span>
            </div>
          ))}
        </div>
        <p className="lp-limits mono">Supports early comparison. Does not certify landing safety, power or radio performance.</p>
      </div>
    </section>
  )
}

export function Film({ innerRef, playing, onPlay }: { innerRef: RefObject<HTMLElement | null>; playing: boolean; onPlay: () => void }) {
  return (
    <section className="lp-section lp-dark lp-film" data-band="dark" ref={innerRef}>
      <div className="lp-wrap">
        <h2 className="lp-display lp-title">The whole idea in 44 seconds.</h2>
        <div className="lp-shot lp-film-frame">
          {playing ? (
            <video src={asset('moonrizon-film.mp4')} poster={asset('film-poster.webp')} controls autoPlay playsInline />
          ) : (
            <button type="button" className="lp-film-poster" onClick={onPlay}>
              <img src={asset('film-poster.webp')} alt="" width={1600} height={900} loading="lazy" decoding="async" />
              <span className="lp-film-play">
                <Play aria-hidden="true" />
                Play the film
                <span className="sr-only">, 44 seconds, with music</span>
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

/** The closing ridge, shaped like the ones in the film's end card. */
const CLOSING_RIDGE = (() => {
  const pts: string[] = []
  for (let x = 0; x <= 1000; x += 5) {
    const u = x / 1000
    const y = 60 - 40 * (0.55 * Math.sin(u * 5.1 + 2.2) + 0.3 * Math.sin(u * 11.7 + 0.7) + 0.15 * Math.sin(u * 27.3 + 4.1))
    pts.push(`${x},${y.toFixed(1)}`)
  }
  return `M0,120 L${pts.join(' L')} L1000,120 Z`
})()

export function Closing() {
  const ref = useRef<HTMLElement>(null)
  const seen = useSeen(ref, 0.2)
  return (
    <section className={seen ? 'lp-closing lp-seen' : 'lp-closing'} data-band="indigo" ref={ref}>
      <Stars count={70} seed={21} />
      <div className="lp-wrap lp-closing-main">
        <div className="lp-closing-brand">
          <DomeCatBuild run={seen} />
          <span className="lp-display">Moonrizon</span>
        </div>
        <h2 className="lp-display lp-closing-line" key={String(seen)}>
          <Words text="Before you land," />
          <br />
          <Words text="look up." from={3} />
        </h2>
        <TryButton tone="paper" />
      </div>
      <footer className="lp-footer">
        <svg className="lp-footer-ridge" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
          <path d={CLOSING_RIDGE} />
        </svg>
        <div className="lp-footer-band">
          <div className="lp-wrap lp-footer-text">
            <p>NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator</p>
            <p>
              LRO WAC mosaic: NASA/GSFC/Arizona State University. LOLA terrain: NASA/GSFC, via NASA Moon Trek. Ephemerides: NASA/JPL Horizons. Independent tool, not endorsed by NASA.
            </p>
          </div>
        </div>
      </footer>
    </section>
  )
}
