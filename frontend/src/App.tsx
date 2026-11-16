import { useEffect, useRef } from 'react'
import { ComparePicker } from './features/ComparePicker'
import { CompareScreen } from './screens/CompareScreen'
import { KitScreen } from './screens/KitScreen'
import { MoonScreen } from './screens/MoonScreen'
import { SiteScreen } from './screens/SiteScreen'
import { loadCoverage, loadRegionCatalog, loadSiteCatalog, runScenario } from './state/runner'
import { getState, screenFromHash, setState, useStore, type ScenarioKey } from './state/store'
import './screens/screens.css'
import './screens/responsive.css'
import './screens/audiences.css'

/** Re-run a scenario shortly after its inputs settle; superseded runs are aborted. */
function useAutoRun() {
  const A = useStore((s) => s.scenarios.A.input)
  const B = useStore((s) => s.scenarios.B.input)
  const compare = useStore((s) => s.compare)
  const durationDays = useStore((s) => s.durationDays)
  const stepMinutes = useStore((s) => s.stepMinutes)
  const screen = useStore((s) => s.screen)
  const azimuthStepDeg = useStore((s) => s.azimuthStepDeg)
  const maxDistanceKm = useStore((s) => s.maxDistanceKm)
  const lastKeys = useRef<Partial<Record<ScenarioKey, string>>>({})

  useEffect(() => {
    if (screen !== 'site') return
    const timer = setTimeout(() => {
      const wanted: [ScenarioKey, typeof A][] = compare ? [['A', A], ['B', B]] : [['A', A]]
      for (const [key, input] of wanted) {
        const k = JSON.stringify([input, durationDays, stepMinutes, azimuthStepDeg, maxDistanceKm])
        if (lastKeys.current[key] === k && getState().scenarios[key].run.phase !== 'idle') continue
        lastKeys.current[key] = k
        void runScenario(key)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [A, B, compare, durationDays, stepMinutes, screen, azimuthStepDeg, maxDistanceKm])
}

/** Space toggles playback on the site view, outside form controls. */
function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const screen = getState().screen
      if (screen !== 'site' && screen !== 'compare') return
      if (t.closest('input, select, textarea, button, a, [role="slider"]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        setState({ playing: !getState().playing })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function useHashRoute() {
  useEffect(() => {
    const onHash = () => setState({ screen: screenFromHash(location.hash), playing: false })
    // The app can mount after a hash change it never saw (coming back from the landing page).
    if (getState().screen !== screenFromHash(location.hash)) onHash()
    window.addEventListener('popstate', onHash)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('popstate', onHash)
      window.removeEventListener('hashchange', onHash)
    }
  }, [])
}

export default function App() {
  const screen = useStore((s) => s.screen)
  const audience = useStore((s) => s.audience)
  useAutoRun()
  useKeyboard()
  useHashRoute()
  useEffect(() => {
    void loadCoverage()
    void loadRegionCatalog()
    void loadSiteCatalog()
  }, [])
  useEffect(() => {
    document.documentElement.dataset.audience = audience
  }, [audience])

  return (
    <div className="app" data-screen={screen}>
      {(screen === 'moon' || screen === 'explore') && <MoonScreen mode={screen} />}
      {screen === 'site' && <SiteScreen />}
      {screen === 'compare' && <CompareScreen />}
      {screen === 'kit' && <KitScreen />}
      <ComparePicker />
    </div>
  )
}
