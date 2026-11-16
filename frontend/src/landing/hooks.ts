import { useEffect, useRef, useState, type RefObject } from 'react'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** Run `read` once per frame while the page scrolls or resizes. */
export function useOnScroll(read: () => void) {
  const latest = useRef(read)
  useEffect(() => {
    latest.current = read
  })
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = 0
      latest.current()
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }
    tick()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
    }
  }, [])
}

/** How far a tall track has been scrolled past a viewport-high sticky child (0..1). */
export function useTrackProgress(ref: RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0)
  useOnScroll(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const span = rect.height - window.innerHeight
    setP(span > 0 ? clamp01(-rect.top / span) : 0)
  })
  const scrollTo = (target: number) => {
    const el = ref.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top + clamp01(target) * (el.offsetHeight - window.innerHeight) })
  }
  return { p, scrollTo }
}

/** Writes `--p` (0 entering at the bottom, 1 leaving at the top) on the element. */
export function useViewProgress(ref: RefObject<HTMLElement | null>) {
  useOnScroll(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const p = clamp01((window.innerHeight - rect.top) / (window.innerHeight + rect.height))
    el.style.setProperty('--p', p.toFixed(3))
  })
}

/** True from the first time the element is on screen. */
export function useSeen(ref: RefObject<HTMLElement | null>, threshold = 0.35): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSeen(true)
      },
      { threshold },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, seen, threshold])
  return seen
}

export function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      // A detached or not-yet-laid-out box reports 0 x 0; keep the last real size.
      if (el.clientWidth && el.clientHeight) setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

const easeOut = (t: number) => 1 - (1 - t) ** 4

/** Eased 0..1 ramp that starts when `run` turns true. */
export function useRamp(run: boolean, ms: number, delay = 0): number {
  const reduced = useReducedMotion()
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!run || reduced) return
    let raf = 0
    const start = performance.now() + delay
    const step = (now: number) => {
      const x = clamp01((now - start) / ms)
      setT(easeOut(x))
      if (x < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [run, ms, delay, reduced])
  return run && reduced ? 1 : t
}
