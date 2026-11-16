import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'

// Must be set before CesiumJS loads (the globe chunk is imported lazily).
window.CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
