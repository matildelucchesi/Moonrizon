/**
 * A card that waits for its data. While it waits it shows its real title and a
 * quiet placeholder, at the height the card will have, so nothing moves when
 * the data arrives. Once the data is there the content enters (opacity and a
 * short rise, staggered by `index`). All motion is CSS, so it keeps going while
 * the main thread is busy; reduced motion shows the content at once.
 *
 * There is no progress here on purpose: the engine reports no partial results,
 * so nothing is drawn as if it were data.
 */
import type { CSSProperties, ReactNode } from 'react'

interface PendingProps {
  /** True once the data behind this card exists. */
  ready: boolean
  /** The card's own title, shown while it waits. */
  title?: string
  /** What is being worked out, in plain words, beside the pulsing dot. */
  note?: string
  /** Dark windows get light ink. */
  tone?: 'light' | 'dark'
  /** No card of its own: for a placeholder that sits inside a card or a window. */
  bare?: boolean
  /** Height to hold while waiting. */
  minHeight?: number
  /** Position in the page: the content arrives 80 ms later per step (capped). */
  index?: number
  /** The content on screen no longer matches the inputs: keep it, dimmed. */
  dim?: boolean
  className?: string
  children?: ReactNode
}

export function Pending({ ready, title, note, tone = 'light', bare = false, minHeight, index = 0, dim = false, className, children }: PendingProps) {
  const cls = ['ui-pending', `is-${tone}`, bare ? 'is-bare' : 'is-card', ready ? 'is-ready' : 'is-waiting', dim && 'is-dim', className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={!ready && minHeight ? { minHeight } : undefined} aria-busy={!ready}>
      {ready ? (
        <div className="ui-pending-content" style={{ '--i': Math.min(index, 8) } as CSSProperties}>
          {children}
        </div>
      ) : (
        <div className="ui-pending-wait">
          {title && <span className="ui-title">{title}</span>}
          {note && (
            <p className="ui-small ui-pending-note">
              <span className="ui-pulse" aria-hidden="true" />
              {note}
            </p>
          )}
          <span className="ui-pending-line" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
