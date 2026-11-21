import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// CesiumJS loads workers, assets and widgets at runtime from CESIUM_BASE_URL.
// They are served in dev and copied at build time from the installed package,
// so the version always matches the JavaScript bundle.
const require = createRequire(import.meta.url)
const cesiumBuild = join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium')
const CESIUM_PUBLIC_PATH = 'cesium'
const CESIUM_DIRS = ['Workers', 'ThirdParty', 'Assets', 'Widgets']

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
}

function cesiumStatic(): Plugin {
  let outDir = 'dist'
  return {
    name: 'meowrizon:cesium-static',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use(`/${CESIUM_PUBLIC_PATH}/`, (req, res, next) => {
        const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
        const filePath = normalize(join(cesiumBuild, urlPath))
        if (!filePath.startsWith(cesiumBuild) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream')
        createReadStream(filePath).pipe(res)
      })
    },
    closeBundle() {
      // The landing-only build never loads the globe, so it ships without Cesium's static files.
      if (process.env.VITE_LANDING_ONLY === 'true') return
      for (const dir of CESIUM_DIRS) {
        cpSync(join(cesiumBuild, dir), join(outDir, CESIUM_PUBLIC_PATH, dir), { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cesiumStatic()],
  server: {
    // In Docker su Windows le modifiche ai file montati non arrivano come eventi:
    // docker-compose.yml imposta MEOWRIZON_WATCH_POLLING=true.
    watch: { usePolling: process.env.MEOWRIZON_WATCH_POLLING === 'true' },
    proxy: {
      // Used only when VITE_DATA_SOURCE=api: forwards to the Python engine.
      '/api': process.env.MEOWRIZON_API_ORIGIN ?? 'http://localhost:8000',
    },
  },
  build: {
    chunkSizeWarningLimit: 6000,
  },
})
