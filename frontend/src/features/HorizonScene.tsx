/**
 * First-person view of the sky from the site.
 *
 * - The far ridge is the engine's terrain horizon H(az), drawn exactly.
 * - Nearer hills are decoration and always stay below H(az), so they never
 *   hide anything the engine says is visible.
 * - Sun and Earth are drawn at their true apparent size on the same angular
 *   scale as the terrain. The 360° panorama stretches heights and says so.
 */
import { ArrowLeft, ArrowRight, ArrowUp, Info } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { HorizonProfile, ScenarioEvaluation } from '../api/types'
import { compass, compassWord, formatAngle, formatSignedAngle } from '../domain/format'
import { bodyAt, type BodyAtTime } from '../domain/sampling'
import { coverage } from '../domain/eclipses'
import { angularSeparation, azDelta, EARTH_DIAMETER_DEG, earthLitFraction, SUN_DIAMETER_DEG } from '../domain/sky'
import { useElementSize } from '../hooks'
import type { Audience } from '../state/store'
import { phasePath, Segmented, Toggle } from '../ui'
import './loading.css'

type Look = 'sun' | 'earth' | 'both' | 'free'
type Lens = 'eye' | 'wide' | 'panorama'

const EDGE_ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const LENS_FOV: Record<Lens, number> = { eye: 46, wide: 110, panorama: 360 }
const PANORAMA_STRETCH = 4
const DEG = Math.PI / 180

interface Props {
  profile: HorizonProfile
  /**
   * Absent while only the terrain is known: the hills draw from the profile,
   * with the same projection, and the Sun, Earth and controls join when the
   * evaluation arrives.
   */
  evaluation?: ScenarioEvaluation
  cursorMs: number
  audience: Audience
}

function horizonAt(profile: HorizonProfile, az: number): number {
  const { azimuthDeg: azs, elevationDeg: hs } = profile
  const step = 360 / azs.length
  const x = ((((az % 360) + 360) % 360) / step) % azs.length
  const i = Math.floor(x)
  const j = (i + 1) % azs.length
  const f = x - i
  return hs[i] * (1 - f) + hs[j] * f
}

/** Deterministic decorative relief, keyed by azimuth so it turns with the view. */
function makeRelief(seed: number) {
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const waves = Array.from({ length: 6 }, (_, i) => ({ k: 2 + i * 3 + Math.floor(rand() * 3), amp: 1 / (i + 1.4), ph: rand() * Math.PI * 2 }))
  const norm = waves.reduce((s, w) => s + w.amp, 0)
  return (az: number) => waves.reduce((s, w) => s + w.amp * Math.sin(w.k * az * DEG + w.ph), 0) / norm
}

function makeStars(seed: number) {
  let a = (seed ^ 0x9e3779b9) >>> 0
  const rand = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
  return Array.from({ length: 160 }, () => ({ az: rand() * 360, el: -2 + rand() * 70, r: 0.6 + rand() * 0.9, o: 0.18 + rand() * 0.4 }))
}

function niceStep(spanDeg: number): number {
  const raw = spanDeg / 6
  return [0.5, 1, 2, 5, 10, 15, 30].find((s) => s >= raw) ?? 30
}

interface View {
  w: number
  h: number
  centerAz: number
  pxX: number
  pxY: number
  elTop: number
  x: (az: number) => number
  y: (el: number) => number
}

export function HorizonScene({ profile, evaluation, cursorMs, audience }: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  const [look, setLook] = useState<Look>('sun')
  const [lens, setLens] = useState<Lens>('eye')
  const [freeAz, setFreeAz] = useState(0)
  const [showPaths, setShowPaths] = useState(true)
  const drag = useRef<{ x: number; az: number } | null>(null)

  const sun = evaluation ? bodyAt(evaluation, evaluation.sun, evaluation.intervals.sun, cursorMs) : null
  const earth = evaluation ? bodyAt(evaluation, evaluation.earth, evaluation.intervals.earth, cursorMs) : null

  const seed = Math.round(profile.observer.site.latDeg * 1000) * 7919 + Math.round(profile.observer.site.lonEastDeg * 1000)
  const relief = useMemo(() => [makeRelief(seed), makeRelief(seed + 17)], [seed])
  const stars = useMemo(() => makeStars(seed), [seed])

  // ------------------------------------------------------------ view geometry
  const w = size.width
  const h = size.height
  const panorama = lens === 'panorama'
  let fov = LENS_FOV[lens]
  // Without the Sun and Earth yet, face the way the panorama starts.
  const restingAz = profile.observer.site.latDeg < 0 ? 0 : 180
  let centerAz: number
  if (panorama) {
    centerAz = look === 'free' ? freeAz : restingAz
  } else if (look === 'sun') centerAz = sun ? sun.azimuthDeg : restingAz
  else if (look === 'earth') centerAz = earth ? earth.azimuthDeg : restingAz
  else if (look === 'both') {
    if (sun && earth) {
      centerAz = sun.azimuthDeg + azDelta(earth.azimuthDeg, sun.azimuthDeg) / 2
      fov = Math.min(170, Math.max(fov, Math.abs(azDelta(earth.azimuthDeg, sun.azimuthDeg)) + 36))
    } else centerAz = restingAz
  } else centerAz = freeAz

  const pxX = w / fov
  const pxY = panorama ? pxX * PANORAMA_STRETCH : pxX

  // Place the median visible horizon at ~62% of the height, then make room
  // for the body we are following.
  const hRef = (() => {
    const vals: number[] = []
    for (let i = 0; i <= 40; i++) vals.push(horizonAt(profile, centerAz - fov / 2 + (fov * i) / 40))
    vals.sort((a, b) => a - b)
    return vals[20]
  })()
  const spanEl = h / pxY
  let elTop = hRef + spanEl * (panorama ? 0.72 : 0.62)
  const followed = (look === 'sun' ? [sun] : look === 'earth' ? [earth] : look === 'both' ? [sun, earth] : []).filter((b) => b !== null)
  for (const b of followed) {
    if (b.elevationDeg > elTop - spanEl * 0.12) elTop = b.elevationDeg + spanEl * 0.2
  }

  const view: View = {
    w,
    h,
    centerAz,
    pxX,
    pxY,
    elTop,
    x: (az) => w / 2 + azDelta(az, centerAz) * pxX,
    y: (el) => (elTop - el) * pxY,
  }

  // ------------------------------------------------------------ terrain
  const terrain = useMemo(() => {
    if (w <= 0 || h <= 0) return null
    const n = Math.ceil(w / 3)
    const far: [number, number][] = []
    let floor = 0
    for (let i = 0; i <= n; i++) {
      const px = (w * i) / n
      const az = centerAz + (px - w / 2) / pxX
      const py = (elTop - horizonAt(profile, az)) * pxY
      far.push([px, py])
      floor = Math.max(floor, py)
    }
    const room = Math.max(40, h - floor)
    const layer = (k: number, base: number, amp: number, above: [number, number][], gap: number) =>
      above.map(([px, py]) => {
        const az = centerAz + (px - w / 2) / pxX
        const top = floor + room * base + room * amp * relief[k](az)
        return [px, Math.max(py + gap, top)] as [number, number]
      })
    const mid = layer(0, 0.24, 0.1, far, 6)
    const near = layer(1, 0.58, 0.12, mid, 8)
    const line = (pts: [number, number][]) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
    const area = (pts: [number, number][]) => `${line(pts)} L${w} ${h} L0 ${h} Z`
    return { farLine: line(far), farArea: area(far), midLine: line(mid), midArea: area(mid), nearLine: line(near), nearArea: area(near), floor }
  }, [profile, centerAz, pxX, pxY, elTop, w, h, relief])

  // ------------------------------------------------------------ paths over the period
  const paths = useMemo(() => {
    if (!evaluation || !showPaths || w <= 0) return null
    const build = (track: ScenarioEvaluation['sun']) => {
      const segs: string[] = []
      let cur: string[] = []
      let prevX: number | null = null
      for (let i = 0; i < evaluation.timesMs.length; i++) {
        const px = w / 2 + azDelta(track.azimuthDeg[i], centerAz) * pxX
        const py = (elTop - track.elevationDeg[i]) * pxY
        const out = px < -w * 0.2 || px > w * 1.2 || py < -h || py > h * 2
        if (out || (prevX !== null && Math.abs(px - prevX) > w / 2)) {
          if (cur.length > 1) segs.push(cur.join(' '))
          cur = []
          prevX = out ? null : px
          if (out) continue
        }
        cur.push(`${cur.length ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`)
        prevX = px
      }
      if (cur.length > 1) segs.push(cur.join(' '))
      return segs.join(' ')
    }
    return { sun: build(evaluation.sun), earth: build(evaluation.earth) }
  }, [showPaths, evaluation, centerAz, pxX, pxY, elTop, w, h])

  // ------------------------------------------------------------ interaction
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, az: centerAz }
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const dx = e.clientX - drag.current.x
    if (Math.abs(dx) < 3 && look !== 'free') return
    setLook('free')
    setFreeAz((((drag.current.az - dx / pxX) % 360) + 360) % 360)
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = (e.shiftKey ? 30 : 5) * (e.key === 'ArrowLeft' ? -1 : 1)
    setLook('free')
    setFreeAz((((centerAz + step) % 360) + 360) % 360)
  }

  // ------------------------------------------------------------ terrain only
  // Only the terrain exists so far: its far ridge is the engine's own horizon.
  // The outline draws once, then the rock fades in. Nothing else is drawn.
  if (!evaluation || !sun || !earth) {
    return (
      <div className="scene" ref={ref}>
        {w > 0 && h > 0 && terrain && (
          <svg width={w} height={h} style={{ display: 'block' }} aria-hidden="true">
            <rect width={w} height={h} fill="var(--space)" />
            <path d={terrain.farArea} className="scene-draw-rock" />
            <path d={terrain.farLine} pathLength={1} className="scene-draw-line" />
          </svg>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------ derived drawing values
  const sx = view.x(sun.azimuthDeg)
  const sy = view.y(sun.elevationDeg)
  const ex = view.x(earth.azimuthDeg)
  const ey = view.y(earth.elevationDeg)
  const sunR = Math.max(2.5, (sun.angularRadiusDeg ?? SUN_DIAMETER_DEG / 2) * pxY)
  const earthR = Math.max(4, (earth.angularRadiusDeg ?? EARTH_DIAMETER_DEG / 2) * pxY)
  const elongation = angularSeparation(sun.azimuthDeg, sun.elevationDeg, earth.azimuthDeg, earth.elevationDeg)
  const lit = earth.illuminatedFraction ?? earthLitFraction(elongation)
  const litAngle = (Math.atan2(sy - ey, sx - ex) * 180) / Math.PI
  const eclipse = sun.occultedFraction ?? coverage(elongation)

  const grid = audience !== 'public'
  const yStep = niceStep(spanEl)
  const yTicks: number[] = []
  if (grid) for (let v = Math.ceil((elTop - spanEl) / yStep) * yStep; v <= elTop; v += yStep) yTicks.push(v)

  const azStep = audience === 'planner' ? (fov > 150 ? 30 : 10) : 45
  const azTicks: number[] = []
  for (let a = Math.ceil((centerAz - fov / 2) / azStep) * azStep; a <= centerAz + fov / 2; a += azStep) azTicks.push(a)

  const scaleNote = panorama ? `360° · heights ×${PANORAMA_STRETCH}` : `1° = ${pxX.toFixed(0)} px`

  // Bodies outside the view: an edge button turns the view towards them.
  const edges: { body: 'sun' | 'earth'; side: 'left' | 'right' | 'up'; x: number; y: number; el: number }[] = []
  for (const [body, bx, by, br, at] of [
    ['sun', sx, sy, sunR, sun],
    ['earth', ex, ey, earthR, earth],
  ] as const) {
    if (bx < -br) edges.push({ body, side: 'left', x: 0, y: Math.max(64, Math.min(h - 120, by)), el: at.elevationDeg })
    else if (bx > w + br) edges.push({ body, side: 'right', x: 0, y: Math.max(64, Math.min(h - 120, by)), el: at.elevationDeg })
    else if (by < -br) edges.push({ body, side: 'up', x: Math.max(16, Math.min(w - 160, bx - 48)), y: 0, el: at.elevationDeg })
  }

  // Labels for the bodies in view, placed so they never cover each other.
  const onScreen = (x: number, y: number, r: number) => x >= -r && x <= w + r && y >= -r && y <= h + r
  const labelled = [
    { spec: labelSpec('sun', sun, audience, undefined, 0), cx: sx, cy: sy, r: sunR, hidden: !sun.visible },
    { spec: labelSpec('earth', earth, audience, lit, eclipse), cx: ex, cy: ey, r: earthR, hidden: !earth.visible },
  ].filter((m) => onScreen(m.cx, m.cy, m.r))
  // Furniture: controls row, full-screen button, orbit thumbnail, compass.
  const furniture: Rect[] = [
    { x: 0, y: 0, w: Math.min(w, 560), h: 64 },
    { x: w - 64, y: 0, w: 64, h: 64 },
    { x: w - 224, y: h - 160, w: 224, h: 160 },
  ]
  const boxes = placeLabels(labelled, w, h, furniture)
  const marks = labelled.map((m, i) => ({ ...m, box: boxes[i] }))

  const summary = `${profile.observer.site.latDeg.toFixed(2)}°, ${profile.observer.site.lonEastDeg.toFixed(2)}°. Sun ${sun.visible ? 'visible' : 'hidden by terrain'}, Earth ${earth.visible ? 'visible' : 'hidden by terrain'}.`

  return (
    <div className="scene" ref={ref}>
      {w > 0 && h > 0 && terrain && (
        <svg
          width={w}
          height={h}
          className="scene-svg"
          role="img"
          aria-label={`View from the site, looking ${compassWord(centerAz)}. ${summary} Drag or use the arrow keys to look around.`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        >
          <defs>

          </defs>

          <rect width={w} height={h} fill="var(--space)" />

          <g aria-hidden="true" className="scene-arrive">
            {stars.map((s, i) => {
              const px = view.x(s.az)
              const py = view.y(s.el)
              if (px < 0 || px > w || py < 0 || py > terrain.floor) return null
              return <circle key={i} cx={px} cy={py} r={s.r} fill="#ffffff" opacity={s.o * (sun.visible ? 0.55 : 1)} />
            })}
          </g>

          {grid && (
            <g className="scene-grid scene-arrive" aria-hidden="true">
              {yTicks.map((v) => (
                <g key={v}>
                  <line x1={0} x2={w} y1={view.y(v)} y2={view.y(v)} className={v === 0 ? 'is-zero' : undefined} />
                  <text x={12} y={view.y(v) - 6} className="scene-grid-label">
                    {v === 0 ? 'Flat horizon 0°' : formatAngle(v, yStep < 1 ? 1 : 0)}
                  </text>
                </g>
              ))}
              {audience === 'planner' &&
                azTicks.map((a) => <line key={a} x1={view.x(a)} x2={view.x(a)} y1={0} y2={h} className="is-az" />)}
            </g>
          )}

          {paths && (
            <g aria-hidden="true" className="scene-arrive">
              <path d={paths.earth} className="scene-path is-earth" />
              <path d={paths.sun} className="scene-path is-sun" />
            </g>
          )}

          {/* Bodies before terrain, so the terrain hides them for real. */}
          <g aria-hidden="true" className="scene-arrive">
            <circle cx={sx} cy={sy} r={sunR} fill="var(--sun)" opacity={1 - eclipse * 0.85} />
            <g>
              <circle cx={ex} cy={ey} r={earthR} fill="var(--earth-night)" />
              <path d={phasePath(earthR, lit)} fill="var(--earth-sky)" transform={`translate(${ex} ${ey}) rotate(${litAngle})`} />
              {eclipse > 0 && (
                <circle cx={ex} cy={ey} r={earthR + 1} fill="none" stroke="var(--red-ring)" strokeWidth={1.5} opacity={0.5 + 0.5 * eclipse} />
              )}
            </g>
          </g>

          <g aria-hidden="true">
            <path d={terrain.farArea} fill="var(--rock-far-top)" />
            <path d={terrain.farLine} fill="none" stroke="var(--space-ink-2)" strokeOpacity={0.7} strokeWidth={1} strokeLinejoin="round" />
            <path d={terrain.midArea} fill="var(--rock-mid-top)" className="scene-arrive" />
            <path d={terrain.nearArea} fill="var(--rock-near-top)" className="scene-arrive" />
          </g>

          {audience === 'planner' && (
            <g aria-hidden="true" className="scene-arrive">
              <path d={terrain.farLine} fill="none" stroke="var(--space-ink)" strokeWidth={1} strokeDasharray="4 4" />
              <text x={w - 14} y={Math.max(18, view.y(horizonAt(profile, centerAz + (w / 2 - 14) / pxX)) - 10)} textAnchor="end" className="scene-mono">
                Terrain horizon H(az)
              </text>
            </g>
          )}

          {marks.map((m) => (
            <BodyMark key={m.spec.body} {...m} audience={audience} eclipse={eclipse} />
          ))}

          <g className="scene-compass scene-arrive" aria-hidden="true">
            {azTicks.map((a) => {
              const px = view.x(a)
              const norm = ((a % 360) + 360) % 360
              const cardinal = norm % 90 === 0
              const label =
                audience === 'planner' ? (cardinal ? `${compass(norm)} ${norm}°` : `${norm}°`) : audience === 'public' ? compassWord(norm) : cardinal ? compassWord(norm) : ''
              return (
                <g key={a}>
                  <line x1={px} x2={px} y1={h - 26} y2={h - (cardinal ? 12 : 18)} />
                  {label && (
                    <text x={px} y={h - 32} textAnchor="middle" className={cardinal ? 'is-cardinal' : undefined}>
                      {label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      )}

      <div className="scene-controls ui-reveal">
        <Segmented<Look>
          label="Look at"
          tone="on-dark"
          size="s"
          value={look}
          onChange={setLook}
          options={[
            { value: 'sun', label: 'Sun' },
            { value: 'earth', label: 'Earth' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <Segmented<Lens>
          label="Lens"
          tone="on-dark"
          size="s"
          value={lens}
          onChange={setLens}
          options={[
            { value: 'eye', label: 'Eye', title: `${LENS_FOV.eye}° wide, true scale` },
            { value: 'wide', label: 'Wide', title: `${LENS_FOV.wide}° wide, true scale` },
            { value: 'panorama', label: '360°', title: 'All around, heights stretched' },
          ]}
        />
        {audience !== 'public' && (
          <span className="scene-toggle">
            <Toggle checked={showPaths} onChange={setShowPaths} onDark>
              Paths
            </Toggle>
          </span>
        )}
      </div>
      {w > 0 &&
        edges.map((e) => (
          <button
            key={e.body}
            type="button"
            className={`scene-edge-btn is-${e.side}`}
            style={e.side === 'left' ? { left: 16, top: e.y } : e.side === 'right' ? { right: 16, top: e.y } : { left: e.x, top: 64 }}
            onClick={() => setLook(e.body)}
            aria-label={`Turn to ${e.body === 'sun' ? 'the Sun' : 'Earth'}`}
          >
            {e.side === 'left' ? <ArrowLeft {...EDGE_ICON} /> : e.side === 'up' ? <ArrowUp {...EDGE_ICON} /> : null}
            {e.body === 'sun' ? 'Sun' : 'Earth'}
            {audience !== 'public' && <span className="mono">{formatAngle(e.el)}</span>}
            {e.side === 'right' && <ArrowRight {...EDGE_ICON} />}
          </button>
        ))}
      <span className="scene-legend" title={audience === 'public' ? 'Sun and Earth are drawn at their real size in the sky' : undefined}>
        {audience === 'public' && !panorama ? (
          <>
            <Info size={16} strokeWidth={1.75} aria-hidden="true" />
            Real size
          </>
        ) : (
          scaleNote
        )}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ labels */

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface LabelSpec {
  body: 'sun' | 'earth'
  lines: string[]
  /** Short state shown after the name on planner labels. */
  state: string
  w: number
  h: number
}

/** Text and size of a body's label for an audience (measured, not guessed per frame). */
function labelSpec(body: 'sun' | 'earth', at: BodyAtTime, audience: Audience, lit: number | undefined, eclipse: number): LabelSpec {
  const name = body === 'sun' ? 'Sun' : 'Earth'
  const margin = at.elevationDeg - at.horizonDeg
  const hidden = !at.visible
  if (audience === 'planner') {
    const lines = [name, `Az ${at.azimuthDeg.toFixed(1)}°  El ${formatAngle(at.elevationDeg, 2)}`, `Margin ${formatSignedAngle(margin)}${body === 'earth' && lit !== undefined ? `  Lit ${Math.round(lit * 100)}%` : ''}`]
    const state = `${hidden ? '  · hidden' : '  · visible'}${eclipse > 0 ? `  · eclipse ${Math.round(eclipse * 100)}%` : ''}`
    const chars = Math.max(lines[0].length + state.length, lines[1].length, lines[2].length)
    return { body, lines, state, w: Math.ceil((chars * 7.4 + 32) / 8) * 8, h: 80 }
  }
  const label =
    eclipse > 0
      ? audience === 'public'
        ? 'Eclipse! Earth hides the Sun'
        : `Eclipse · Earth covers ${eclipse >= 1 ? 'all' : `${Math.round(eclipse * 100)}%`} of the Sun`
      : audience === 'public'
        ? hidden
          ? `${name} · behind the hills`
          : name
        : hidden
          ? `${name} · hidden, ${formatAngle(Math.abs(margin))} below the hills`
          : `${name} · ${formatAngle(margin)} above the hills`
  return { body, lines: [label], state: '', w: Math.ceil((label.length * (audience === 'public' ? 12.5 : 10.4) + 32) / 8) * 8, h: 48 }
}

function overlapArea(a: Rect, b: Rect, pad = 8): number {
  const w = Math.min(a.x + a.w, b.x + b.w + pad) - Math.max(a.x, b.x - pad)
  const h = Math.min(a.y + a.h, b.y + b.h + pad) - Math.max(a.y, b.y - pad)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Places each label next to its body without covering the other label, the
 * other body or the window furniture. Tries eight positions around the body
 * and keeps the one with the least overlap.
 */
function placeLabels(
  items: { spec: LabelSpec; cx: number; cy: number; r: number }[],
  w: number,
  h: number,
  furniture: Rect[],
): Rect[] {
  const placed: Rect[] = []
  const bodies: Rect[] = items.map((i) => ({ x: i.cx - i.r - 8, y: i.cy - i.r - 8, w: 2 * i.r + 16, h: 2 * i.r + 16 }))
  items.forEach((it, k) => {
    const { w: lw, h: lh } = it.spec
    const g = it.r + 16
    const candidates: [number, number][] = [
      [it.cx + g, it.cy - g - lh],
      [it.cx + g, it.cy + g],
      [it.cx - g - lw, it.cy - g - lh],
      [it.cx - g - lw, it.cy + g],
      [it.cx + g, it.cy - lh / 2],
      [it.cx - g - lw, it.cy - lh / 2],
      [it.cx - lw / 2, it.cy - g - lh],
      [it.cx - lw / 2, it.cy + g],
    ]
    let best: Rect | null = null
    let bestScore = Infinity
    candidates.forEach(([x, y], order) => {
      const r: Rect = { x: Math.max(16, Math.min(w - 16 - lw, x)), y: Math.max(64, Math.min(h - 64 - lh, y)), w: lw, h: lh }
      let score = order * 4
      for (const p of placed) score += overlapArea(r, p) * 10
      bodies.forEach((b, j) => {
        score += overlapArea(r, b, 0) * (j === k ? 6 : 10)
      })
      for (const f of furniture) score += overlapArea(r, f) * 4
      if (score < bestScore) {
        bestScore = score
        best = r
      }
    })
    placed.push(best ?? { x: 16, y: 64, w: lw, h: lh })
  })
  return placed
}

/** Point on the rectangle's edge closest to (x, y). */
function nearest(r: Rect, x: number, y: number): [number, number] {
  return [Math.max(r.x, Math.min(r.x + r.w, x)), Math.max(r.y, Math.min(r.y + r.h, y))]
}

interface MarkProps {
  spec: LabelSpec
  box: Rect
  hidden: boolean
  cx: number
  cy: number
  r: number
  audience: Audience
  eclipse: number
}

function BodyMark({ spec, box, hidden, cx, cy, r, audience, eclipse }: MarkProps) {
  const tone = spec.body === 'sun' ? 'is-sun' : 'is-earth'
  const [px, py] = nearest(box, cx, cy)
  const dist = Math.hypot(px - cx, py - cy) || 1
  const edge = audience === 'planner' ? Math.max(r + 8, 16) : r + 4
  const sx = cx + ((px - cx) / dist) * edge
  const sy = cy + ((py - cy) / dist) * edge

  if (audience === 'planner') {
    const b = Math.max(r + 8, 16)
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    return (
      <g className={`scene-hud ${tone}${hidden ? ' is-hidden' : ''}`}>
        {corners.map(([kx, ky]) => (
          <path key={`${kx}${ky}`} d={`M${cx + kx * b} ${cy + ky * b - ky * 8} V${cy + ky * b} H${cx + kx * b - kx * 8}`} />
        ))}
        {hidden && <circle cx={cx} cy={cy} r={r} className="scene-ghost" />}
        <line x1={sx} y1={sy} x2={px} y2={py} className="scene-leader" />
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
        {spec.lines.map((l, i) => (
          <text key={i} x={box.x + 16} y={box.y + 24 + i * 20} className={i === 0 ? 'is-head' : undefined}>
            {l}
            {i === 0 && <tspan className="scene-hud-state">{spec.state}</tspan>}
          </text>
        ))}
      </g>
    )
  }

  return (
    <g className={`scene-bubble ${tone}${hidden ? ' is-hidden' : ''}${eclipse > 0 ? ' is-eclipse' : ''}`}>
      {hidden && <circle cx={cx} cy={cy} r={Math.max(r, 6)} className="scene-ghost" />}
      <path d={`M${sx} ${sy} L${px} ${py}`} className="scene-bubble-line" />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={16} />
      <text x={box.x + 16} y={box.y + 31}>
        {spec.lines[0]}
      </text>
    </g>
  )
}
