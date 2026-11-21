import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { seeded } from './model'

/** Where the one action on this page goes: the app's opening screen. */
export const APP_HREF = '#/moon'

/** Landing-only build: the app is not online yet, so the action is shown but disabled. */
const COMING_SOON = import.meta.env.VITE_LANDING_ONLY === 'true'

/** Words that land one after the other, as in the promo film. */
export function Words({ text, from = 0, accent }: { text: string; from?: number; accent?: 'sun' | 'earth' | 'primary' | 'quiet' }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <span key={i} className={accent ? `lp-word lp-${accent}` : 'lp-word'} style={{ '--i': from + i } as CSSProperties}>
          {word}{' '}
        </span>
      ))}
    </>
  )
}

export function TryButton({ size = 'big', tone = 'primary', children = 'Try Moonrizon' }: { size?: 'big' | 'small'; tone?: 'primary' | 'paper'; children?: ReactNode }) {
  if (COMING_SOON) {
    return (
      <span className={`lp-try lp-try-${size} lp-try-${tone} lp-try-soon`} aria-disabled="true">
        <span>Coming soon</span>
      </span>
    )
  }
  return (
    <a className={`lp-try lp-try-${size} lp-try-${tone}`} href={APP_HREF}>
      <span>{children}</span>
      {size === 'big' && <ArrowRight aria-hidden="true" />}
    </a>
  )
}

/** Fixed star field in a 1000 x 1000 box, stretched over its parent. */
export function Stars({ count = 90, seed = 5, twinkle = true }: { count?: number; seed?: number; twinkle?: boolean }) {
  const stars = useMemo(() => {
    const r = seeded(seed)
    return Array.from({ length: count }, (_, i) => ({ x: r() * 1000, y: r() * 1000, r: 0.6 + r() * 1.2, o: 0.2 + r() * 0.55, tw: twinkle && i % 3 === 0, d: r() * 4 }))
  }, [count, seed, twinkle])
  return (
    <svg className="lp-stars" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      {stars.map((s, i) => (
        // A zero-length round-capped stroke stays a round dot however the box is stretched.
        <path key={i} d={`M${s.x.toFixed(1)} ${s.y.toFixed(1)}h0.01`} strokeWidth={(s.r * 2).toFixed(1)} opacity={s.o} className={s.tw ? 'lp-twinkle' : undefined} style={s.tw ? { animationDelay: `${s.d.toFixed(2)}s` } : undefined} />
      ))}
    </svg>
  )
}

/** The dome-cat mark assembling itself: horizon, dome, ears, then the two suns. */
export function DomeCatBuild({ run, size = 120 }: { run: boolean; size?: number }) {
  return (
    <svg className={run ? 'lp-mark lp-mark-run' : 'lp-mark'} viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id="lp-mark-clip">
          <rect x="-10" y="-20" width="70" height="58" />
        </clipPath>
      </defs>
      <g clipPath="url(#lp-mark-clip)">
        <g className="lp-mark-dome">
          <path className="lp-mark-ear" d="M6.5 31 L7.5 18 L15 26.5 Z" style={{ transformOrigin: '7px 31px' }} />
          <path className="lp-mark-ear lp-mark-ear-2" d="M25.5 31 L24.5 18 L17 26.5 Z" style={{ transformOrigin: '25px 31px' }} />
          <path d="M4 38 A12 12 0 0 1 28 38 Z" />
        </g>
      </g>
      <path className="lp-mark-line" d="M3 38 H45" pathLength={1} />
      <circle className="lp-mark-sun" cx="33" cy="14" r="4" style={{ transformOrigin: '33px 14px' }} />
      <circle className="lp-mark-earth" cx="40.5" cy="26.5" r="5" style={{ transformOrigin: '40.5px 26.5px' }} />
    </svg>
  )
}
