import { Suspense, lazy, useEffect, useState } from 'react'
import { Landing } from './landing/Landing'

// The app (store, CesiumJS, API calls) loads only once someone leaves the landing page.
const App = lazy(() => import('./App'))

const onLanding = () => location.hash.startsWith('#/welcome')

export function Root() {
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
