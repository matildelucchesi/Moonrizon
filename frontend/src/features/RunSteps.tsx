/**
 * The three jobs behind the site page, as a short list in the space window:
 * the terrain, the Sun and Earth over the period, then the month before (for
 * the changes beside the numbers). Each step is done, current or still to come.
 * The current one carries a clock; under the list sits the engine's own
 * message. This is the page's one live region (the clock stays silent).
 *
 * The dot and the fade are CSS. The only script is one interval, once a
 * second, for the clock and for noticing a message that has not changed.
 */
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import './loading.css'

const STEPS = ['Terrain around the site', 'Sun and Earth over the period', 'The month before, for comparison'] as const

/** A message that stays the same this long gets "still working" after it. */
const STILL_WORKING_MS = 8000

/** Index of the step being worked on; STEPS.length once all three are finished. */
export const STEPS_DONE = STEPS.length

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One interval while a step is current: the time, and whether the message has stalled. */
function useRunClock(active: boolean, message: string): { now: number; stalled: boolean } {
  const [now, setNow] = useState(() => Date.now())
  const [stalledOn, setStalledOn] = useState<string | null>(null)
  const since = useRef(0)

  useEffect(() => {
    since.current = Date.now()
  }, [message])

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      setStalledOn(t - since.current >= STILL_WORKING_MS ? message : null)
    }, 1000)
    return () => window.clearInterval(id)
  }, [active, message])

  return { now, stalled: active && stalledOn === message }
}

interface RunStepsProps {
  /** The step being worked on (0 to 2), or STEPS_DONE when everything is finished. */
  step: number
  /** When the calculation started (ms since epoch). */
  startedAt?: number
  /** What the engine says it is doing, verbatim. */
  message: string
  /** The scene has its own controls in the corner: sit below them. */
  belowControls?: boolean
}

export function RunSteps({ step, startedAt, message, belowControls = false }: RunStepsProps) {
  const active = step < STEPS_DONE
  const { now, stalled } = useRunClock(active, message)
  const cls = ['run-steps', !active && 'is-finished', belowControls && 'is-below'].filter(Boolean).join(' ')

  return (
    <div className={cls} role="status" aria-atomic="false">
      <ol className="run-steps-list">
        {STEPS.map((label, i) => {
          const state = i < step ? 'done' : i === step ? 'now' : 'next'
          return (
            <li key={label} className={`run-step is-${state}`}>
              <span className="run-step-icon" aria-hidden="true">
                {state === 'done' ? <Check size={16} strokeWidth={1.75} /> : state === 'now' ? <span className="ui-pulse" /> : <span className="run-step-hollow" />}
              </span>
              <span>
                {label}
                <span className="sr-only">{state === 'done' ? ', done' : state === 'now' ? ', in progress' : ', waiting'}</span>
              </span>
              {state === 'now' && startedAt !== undefined && (
                <span className="run-step-time" aria-hidden="true">
                  {clock(now - startedAt)}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <p className="run-steps-message">{active ? `${message}${stalled ? ' · still working' : ''}` : ''}</p>
    </div>
  )
}
