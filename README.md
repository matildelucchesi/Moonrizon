# Moonrizon

Moonrizon is a lunar exploration tool that compares locations and dates using terrain horizons, sunlight and geometric Earth visibility. Built for the NASA Space Apps **Lunar Landing Site Navigator** challenge, it helps users explore candidate sites on a 3D Moon, inspect visibility windows and compare mission requirements.

## How it is built

| Component | Technologies | Role |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, CesiumJS | Interactive lunar globe, terrain panorama, timelines, reports and site comparisons |
| Backend | Python 3.12, FastAPI, NumPy, Rasterio, PyProj, Shapely | Data acquisition, terrain analysis, Sun/Earth visibility calculations and background jobs |
| Storage | Local files, GeoTIFF, Parquet and JSON | Source datasets, prepared data, cached calculations and job results; no database required |
| Development and serving | Docker Compose, Vite, nginx | Run both services locally or serve the built frontend |

The project uses Moon Trek region catalogs and imagery, LRO/LOLA elevation products and JPL Horizons ephemerides. The catalog contains 13 historical 2022 Artemis candidate polygons and 9 documented sites.

## How it works

1. Select a catalog site or lunar location and choose a date and analysis period.
2. The frontend submits a terrain-analysis job to the backend. The backend loads numerical elevation data and calculates the local horizon around the observer.
3. A scenario job compares Sun and Earth positions from JPL Horizons with that horizon to calculate visibility, interruptions and simultaneous visibility windows.
4. The frontend polls the jobs and displays their results in the globe, horizon view, timeline and reports. Users can compare points and apply mission requirements; optional energy estimates use configurable panel, load and battery assumptions.

Source data and completed calculations are cached on disk. Initial analyses may need internet access to download upstream data. The frontend uses the backend API by default; an explicit demo mode provides synthetic examples.

## How we worked

The team followed an Agile methodology, organizing work in sprints tracked on Jira.

AI tools (ChatGPT, Claude, Codex and Cursor) supported development for code generation, refactoring, code review and documentation. All AI-assisted output was reviewed by the team.

Results support preliminary exploration. Independent observational validation remains incomplete, and the separate V1 CLI engine has its own calculation path and validation scope. A polygon-center result represents one point, and geometric visibility alone does not establish landing safety, power availability or radio performance. See the [validation review](docs/validazione-engine-v1-revisione.md) for the recorded evidence and limitations.

## Run with Docker

Install Docker with Compose and Node.js/npm. The repository pins Node.js **22.22.1** in `.nvmrc`. Run these commands from the repository root with Docker running:

```sh
npm run setup
npm start
```

`setup` builds the images and initializes the region/site catalogs. It requires internet access and does not download every scientific dataset in advance.

| Service | Default address |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000/api |
| Interactive API documentation | http://localhost:8000/api/docs |
| OpenAPI schema | http://localhost:8000/api/openapi.json |

The frontend proxies `/api` requests to the backend. Both services reload during development. To customize ports or settings, copy `.env.example` to `.env` and edit the relevant values before starting.

Useful commands from the repository root:

```sh
npm run start:bg   # Start development services in the background
npm run stop       # Stop the services
npm run logs       # Follow service logs
npm run status     # Show container status
npm run prod       # Serve the built frontend through nginx at localhost:8080
npm run prod:stop  # Stop the production profile
```

## Run locally without Docker

Use two terminals: one for the backend and one for the frontend. You need Python **3.12** and the Node.js version in `.nvmrc`.

### Backend

From the repository root:

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m app.cli init-regions
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

The catalog initialization downloads Moon Trek polygons and generates the region/site GeoJSON files. The API documentation is available at http://localhost:8000/api/docs after startup.

On Windows, replace `.venv/bin/python` with `.venv\Scripts\python.exe`. A Conda environment is also available in `backend/environment.yml`; see the [backend documentation](backend/README.md) for that setup and further dependency details.

### Frontend

In a second terminal, from the repository root:

```sh
nvm use
npm install
npm run dev
```

Open http://localhost:5173. Vite forwards `/api` to `http://localhost:8000` by default.

Frontend configuration is documented in [frontend/.env.example](frontend/.env.example). Copy it to `frontend/.env.local` to customize settings. Set `MEOWRIZON_API_ORIGIN` if the backend runs at another address, then restart Vite.

To explore synthetic examples without running the backend, set `VITE_DATA_SOURCE=demo` in `frontend/.env.local` and run `npm run dev`. Restore `VITE_DATA_SOURCE=api` to use backend calculations.

## Project structure

```text
frontend/          React interface, Cesium globe and API client
backend/app/       FastAPI service, acquisition, scientific calculations and CLI
backend/catalog/   Versioned region and site definitions
backend/config/    Data acquisition and analysis configurations
backend/docs/      V1 CLI engine documentation
backend/tests/     Backend tests
backend/data/      Backend-local scientific data, caches and analysis results
data/              Root catalog downloads and generated GeoJSON
docs/              Project, scientific, API and validation documentation
```

Runtime datasets are ignored by Git. Docker stores catalog data in root `data/`, while native backend runs default to `backend/data/`. Scientific jobs and CLI analysis also use backend-local storage; details are in the backend guide.

## Documentation

- [Frontend documentation](frontend/README.md): interface, configuration, data modes, comparisons and rendering.
- [Backend documentation](backend/README.md): setup, API jobs, data acquisition, storage and configuration.
- [V1 CLI engine guide](backend/docs/engine-v1.md): analysis commands, schemas, caches and reproducibility.
- [API contract](docs/api-contract.md) and [data dictionary](docs/api-data-dictionary.md): routes, job workflow and response fields.
- [Scientific criteria](docs/criteri-algoritmo.md): calculation definitions and assumptions.
- [Data guide](docs/guida-dati.md) and [regions and sites](docs/siti-e-regioni.md): sources, coordinates and catalog interpretation.
- [Project status and decisions](docs/stato-decisioni.md): implementation scope and remaining work.
- [Validation review](docs/validazione-engine-v1-revisione.md): scientific checks and current limitations.
