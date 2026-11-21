import { Suspense, lazy, useEffect, useState } from 'react'
import { Landing } from './landing/Landing'

const onLanding = () => location.hash.startsWith('#/welcome')

// Landing-only build (e.g. the Vercel deploy): the app branch is dead code and drops out of the bundle.
const LANDING_ONLY = import.meta.env.VITE_LANDING_ONLY === 'true'

// The app (store, CesiumJS, API calls) loads only once someone leaves the landing page.
const App = LANDING_ONLY ? Landing : lazy(() => import('./App'))

export function Root() {
  return LANDING_ONLY ? <Landing /> : <AppRoot />
}

function AppRoot() {
  const [landing, setLanding] = useState(onLanding)
  useEffect(() => {
    const on = () => setLanding(onLanding())
    window.addEventListener('hashchange', on)
    window.addEventListener('popstate', on)
    return () => {
      window.removeEventListener('hashchange', on)
      window.removeEventListener('popstate', on)
    }
  }, [])
  if (landing) return <Landing />
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  )
}
