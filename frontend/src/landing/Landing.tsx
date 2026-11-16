import { useEffect, useRef, useState, type RefObject } from 'react'
import { DomeCatMark } from '../ui/Logo'
import { TryButton } from './bits'
import { HorizonStage } from './HorizonStage'
import { useOnScroll, useReducedMotion } from './hooks'
import { Audiences, Closing, Film, HowItWorks, Numbers, Proof } from './sections'
import './landing.css'

type Tone = 'dark' | 'light' | 'indigo'

/** The header takes the colours of whatever section sits under it. */
function useHeaderTone(root: RefObject<HTMLElement | null>): Tone {
  const [tone, setTone] = useState<Tone>('dark')
  useOnScroll(() => {
    const sections = root.current?.querySelectorAll<HTMLElement>('[data-band]')
    if (!sections) return
    for (const el of sections) {
      const rect = el.getBoundingClientRect()
      if (rect.top <= 40 && rect.bottom > 40) {
        setTone(el.dataset.band as Tone)
        return
      }
    }
  })
  return tone
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const how = useRef<HTMLElement>(null)
  const who = useRef<HTMLElement>(null)
  const proof = useRef<HTMLElement>(null)
  const film = useRef<HTMLElement>(null)
  const [filmPlaying, setFilmPlaying] = useState(false)
  const reduced = useReducedMotion()
  const tone = useHeaderTone(root)

  useEffect(() => {
    const title = document.title
    document.title = 'Moonrizon · Before you land, look up'
    document.documentElement.classList.add('lp-page')
    window.scrollTo(0, 0)
    return () => {
      document.title = title
      document.documentElement.classList.remove('lp-page')
      window.scrollTo(0, 0)
    }
  }, [])

  const go = (ref: RefObject<HTMLElement | null>) => ref.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  const watch = () => {
    setFilmPlaying(true)
    go(film)
  }

  return (
    <div className="lp" ref={root}>
      <header className="lp-header" data-tone={tone}>
        <a className="lp-brand" href="#/welcome" onClick={() => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })}>
          <DomeCatMark size={44} tone={tone === 'light' ? 'light' : 'dark'} />
          <span className="lp-display">Moonrizon</span>
        </a>
        <nav className="lp-nav" aria-label="On this page">
          <button type="button" onClick={() => go(how)}>
            How it works
          </button>
          <button type="button" onClick={() => go(who)}>
            Who it is for
          </button>
          <button type="button" onClick={() => go(proof)}>
            Checked, not guessed
          </button>
        </nav>
        <TryButton size="small" tone={tone === 'indigo' ? 'paper' : 'primary'} />
      </header>
      <main>
        <HorizonStage onFilm={watch} />
        <HowItWorks innerRef={how} />
        <Audiences innerRef={who} />
        <Numbers />
        <Proof innerRef={proof} />
        <Film innerRef={film} playing={filmPlaying} onPlay={() => setFilmPlaying(true)} />
      </main>
      <Closing />
    </div>
  )
}
