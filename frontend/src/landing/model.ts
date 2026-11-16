/**
 * Illustrative month for the landing page: a made-up ridge and two smooth
 * paths, built so the story reads in order (Sun hides, Earth drops, both
 * return). It is not engine output and the page says so.
 *
 * `a` is a horizontal scene coordinate (0..1 spans the part of the ridge the
 * Sun crosses), `u` is time across the month (0..1), elevations are degrees.
 */

export const DAYS = 30
/** Time already elapsed when the page is at the top: day 4.2. */
export const U_START = 0.14

const bump = (t: number) => (Math.abs(t) >= 1 ? 0 : Math.cos((t * Math.PI) / 2) ** 2)

/** Terrain horizon: what the far ridge hides, in degrees above the flat horizon. */
export function ridgeDeg(a: number): number {
  return (
    0.95 +
    0.42 * Math.sin(a * 5.1 + 0.8) +
    0.24 * Math.sin(a * 11.7 + 2.1) +
    0.11 * Math.sin(a * 27.3 + 4) +
    0.05 * Math.sin(a * 61 + 1) +
    1.9 * bump((a - 0.33) / 0.135)
  )
}

export interface Body {
  a: number
  el: number
}

export function sunAt(u: number): Body {
  return { a: 0.05 + 0.7 * u, el: 2.05 + 0.35 * Math.sin(u * Math.PI * 2 * 0.9 + 0.9) }
}

export function earthAt(u: number): Body {
  return { a: 0.88 + 0.03 * Math.sin(u * Math.PI * 2), el: 2.05 + 2.0 * Math.cos((u - 0.02) * Math.PI * 2) }
}

export const isVisible = (b: Body) => b.el > ridgeDeg(b.a)

export type SkyState = 'both' | 'sun' | 'earth' | 'none'

export function skyState(u: number): SkyState {
  const sun = isVisible(sunAt(u))
  const earth = isVisible(earthAt(u))
  return sun && earth ? 'both' : sun ? 'sun' : earth ? 'earth' : 'none'
}

export const STATE_TEXT: Record<SkyState, string> = {
  both: 'power and link',
  sun: 'power, no link',
  earth: 'link, no power',
  none: 'dark and silent',
}

export type Run = [from: number, to: number]

/** Stretches of the month (as 0..1 fractions) where `test` holds. */
export function runs(test: (u: number) => boolean, samples = 600): Run[] {
  const out: Run[] = []
  let start: number | null = null
  for (let i = 0; i <= samples; i++) {
    const u = i / samples
    const on = i < samples && test(u)
    if (on && start === null) start = u
    if (!on && start !== null) {
      out.push([start, u])
      start = null
    }
  }
  return out
}

export const TIMELINE = [
  { id: 'sun', label: 'Sunlight', runs: runs((u) => isVisible(sunAt(u))) },
  { id: 'earth', label: 'Earth in view', runs: runs((u) => isVisible(earthAt(u))) },
  { id: 'both', label: 'Sun + Earth', runs: runs((u) => skyState(u) === 'both') },
] as const

/** Deterministic pseudo-random numbers for stars and the foreground ridges. */
export function seeded(seed: number) {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A decorative foreground ridge as a 0..1 height profile along `a`. */
export function foreground(seed: number) {
  const r = seeded(seed)
  const k = [r() * 6, r() * 6, r() * 6, r() * 6]
  return (a: number) =>
    0.55 * Math.sin(a * 5.1 + k[0]) + 0.3 * Math.sin(a * 11.7 + k[1]) + 0.15 * Math.sin(a * 27.3 + k[2]) + 0.08 * Math.sin(a * 61 + k[3])
}
