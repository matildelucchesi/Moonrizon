import { catalogApi, provider } from '../api'
import { runJob } from '../api/jobs'
import { withRetry } from '../api/retry'
import type { ScenarioEvaluation, SiteCoordinates } from '../api/types'
import { loadRegions, rank, type Region } from '../domain/ranking'
import { regionCatalog, siteCatalog } from '../domain/catalogs'
import { terrainIssue, scenarioIssue } from '../domain/comparison'
import { rankingRequest } from '../domain/rankingRequest'
import { intervalStats } from '../domain/sampling'
import { getState, setState, updateScenario, type ScenarioKey, type SiteSummary } from './store'

const controllers: Partial<Record<ScenarioKey, AbortController>> = {}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Unknown error.'
}

/**
 * Runs terrain analysis then scenario evaluation for one scenario.
 * A newer call aborts the previous one, so changing the site mid-run never
 * lets an outdated result overwrite the current inputs.
 */
export async function runScenario(key: ScenarioKey): Promise<void> {
  controllers[key]?.abort()
  const controller = new AbortController()
  controllers[key] = controller
  const { signal } = controller

  const s = getState()
  const { input } = s.scenarios[key]
  const stopMs = input.startMs + s.durationDays * 86_400_000
  const current = () => {
    const now = getState()
    return !signal.aborted && now.scenarios[key].input === input
      && now.durationDays === s.durationDays && now.stepMinutes === s.stepMinutes
      && now.azimuthStepDeg === s.azimuthStepDeg && now.maxDistanceKm === s.maxDistanceKm
  }

  try {
    updateScenario(key, (sc) => ({ ...sc, run: { phase: 'terrain', progress: 0, stale: true } }))
    const terrain = await runJob(
      () =>
        provider.submitTerrainAnalysis(
          {
            site: input.site,
            observerHeightM: input.observerHeightM,
            config: { azimuthStepDeg: s.azimuthStepDeg, maxDistanceKm: s.maxDistanceKm },
          },
          signal,
        ),
      (id) => provider.getTerrainAnalysis(id, signal),
      (job) => {
        if (current()) updateScenario(key, (sc) => ({ ...sc, run: { ...sc.run, progress: job.progress, message: job.message } }))
      },
      signal,
    )
    if (!current()) return
    updateScenario(key, (sc) => ({ ...sc, run: { phase: 'ephemeris', terrain, progress: 0, stale: false } }))

    const evaluation = await runJob(
      () =>
        provider.submitScenarioEvaluation(
          {
            terrainAnalysisId: terrain.id,
            startUtc: new Date(input.startMs).toISOString(),
            stopUtc: new Date(stopMs).toISOString(),
            stepMinutes: s.stepMinutes,
          },
          signal,
        ),
      (id) => provider.getScenarioEvaluation(id, signal),
      (job) => {
        if (current()) updateScenario(key, (sc) => ({ ...sc, run: { ...sc.run, progress: job.progress, message: job.message } }))
      },
      signal,
    )
    if (!current()) return
    // Inputs may have changed after submission (a rerun is then pending).
    updateScenario(key, (sc) => ({
      ...sc,
      run: { phase: 'ready', terrain, evaluation, stale: sc.input !== input || getState().durationDays !== s.durationDays },
    }))

    // The period before, for the comparison next to every number. Not blocking.
    const previous = await runJob(
      () =>
        provider.submitScenarioEvaluation(
          {
            terrainAnalysisId: terrain.id,
            startUtc: new Date(input.startMs - s.durationDays * 86_400_000).toISOString(),
            stopUtc: new Date(input.startMs).toISOString(),
            stepMinutes: s.stepMinutes,
            includeContext: false,
          },
          signal,
        ),
      (id) => provider.getScenarioEvaluation(id, signal),
      () => undefined,
      signal,
    ).catch(() => undefined)
    if (!current() || !previous) return
    updateScenario(key, (sc) => (sc.run.evaluation === evaluation ? { ...sc, run: { ...sc.run, previous } } : sc))
  } catch (err) {
    if (!current()) return
    updateScenario(key, (sc) => ({ ...sc, run: { ...sc.run, phase: 'error', error: describe(err) } }))
  } finally {
    if (controllers[key] === controller) delete controllers[key]
  }
}

export function summarize(ev: ScenarioEvaluation, startMs: number, endMs: number): SiteSummary {
  return {
    sun: intervalStats(ev.intervals.sun, startMs, endMs).fraction,
    earth: intervalStats(ev.intervals.earth, startMs, endMs).fraction,
    both: intervalStats(ev.intervals.both, startMs, endMs).fraction,
    nightH: intervalStats(ev.intervals.sun, startMs, endMs).longestOffMs / 3_600_000,
    earthOutageH: intervalStats(ev.intervals.earth, startMs, endMs).longestOffMs / 3_600_000,
    jointWindowH: intervalStats(ev.intervals.both, startMs, endMs).longestOnMs / 3_600_000,
  }
}

let comparisonController: AbortController | null = null

/**
 * Computes the top three regions of the ranking for the same period as
 * scenario A (and the period before), so the site can be compared fairly.
 */
export async function runComparison(): Promise<void> {
  if (provider.kind === 'api') return // No approved regional calculation endpoint yet.
  const s = getState()
  const catalog = s.regions
  const A = s.scenarios.A
  if (!catalog) return
  const own = catalog.regions.find((r) => r.name === A.input.siteName)
  const area = own ? own.area : s.area
  const picks = rank(catalog.regions, area, s.mission).filter((r) => r.name !== A.input.siteName).slice(0, 3)
  const key = JSON.stringify([picks.map((p) => p.id), A.input.startMs, A.input.observerHeightM, s.durationDays, s.stepMinutes])
  if (s.comparison?.key === key) return

  comparisonController?.abort()
  const controller = new AbortController()
  comparisonController = controller
  const { signal } = controller
  setState({ comparison: { key, busy: true, items: [] } })

  const span = s.durationDays * 86_400_000
  const start = A.input.startMs
  const evaluate = async (terrainAnalysisId: string, from: number) =>
    runJob(
      () =>
        provider.submitScenarioEvaluation(
          { terrainAnalysisId, includeContext: false, startUtc: new Date(from).toISOString(), stopUtc: new Date(from + span).toISOString(), stepMinutes: s.stepMinutes },
          signal,
        ),
      (id) => provider.getScenarioEvaluation(id, signal),
      () => undefined,
      signal,
    )
  try {
    const items = await Promise.all(
      picks.map(async (r) => {
        const site: SiteCoordinates = r.center
        const terrain = await runJob(
          () => provider.submitTerrainAnalysis({ priority: 'background', site, observerHeightM: A.input.observerHeightM, config: { azimuthStepDeg: s.azimuthStepDeg, maxDistanceKm: s.maxDistanceKm } }, signal),
          (id) => provider.getTerrainAnalysis(id, signal),
          () => undefined,
          signal,
        )
        const [now, before] = await Promise.all([evaluate(terrain.id, start), evaluate(terrain.id, start - span).catch(() => null)])
        return { name: r.name, now: summarize(now, start, start + span), prev: before ? summarize(before, start - span, start) : null }
      }),
    )
    if (!signal.aborted) setState({ comparison: { key, busy: false, items } })
  } catch {
    if (!signal.aborted) setState({ comparison: { key, busy: false, items: [] } })
  }
}

let rankingController: AbortController | null = null

/**
 * Measures all catalog sites and region centres for scenario A's period with the engine
 * (terrain horizon, then Sun and Earth visibility), four regions at a time, so
 * the results screen can rank them best to worst. The engine keeps finished
 * jobs, so a second visit is immediate.
 */
/** Sites measured at once: matches MEOWRIZON_SCIENTIFIC_WORKERS and stays under the background queue limit (8). */
const RANKING_PARALLEL = 4

export async function runRegionRanking(force = false): Promise<void> {
  if (provider.kind !== 'api') return // Practice data already carries its measurements.
  const s = getState()
  if (!s.sitesLoaded || (!s.regions && !s.regionError)) return
  const { locations, minSunFraction, key } = rankingRequest(s)
  if (!locations.length) {
    rankingController?.abort()
    setState({ ranking: { key, busy: false, total: 0, regions: [], failed: [], skipped: [], current: [] } })
    return
  }
  const A = s.scenarios.A.input
  if (!force && s.ranking?.key === key) return

  rankingController?.abort()
  const controller = new AbortController()
  rankingController = controller
  const { signal } = controller
  const start = A.startMs
  const stop = start + s.durationDays * 86_400_000
  const update = (patch: Partial<NonNullable<ReturnType<typeof getState>['ranking']>>) => {
    const now = getState().ranking
    if (!signal.aborted && now?.key === key) setState({ ranking: { ...now, ...patch } })
  }
  setState({ ranking: { key, busy: true, total: locations.length, regions: [], failed: [], skipped: [], current: [] } })

  // Results arrive out of order: keep every list in catalog order.
  const order = new Map(locations.map((loc, i) => [loc.id, i]))
  const add = <T extends { id: string }>(list: T[] | undefined, item: T): T[] =>
    [...(list ?? []), item].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  const measuring = (name: string, on: boolean) => {
    const now = getState().ranking?.current ?? []
    update({ current: on ? [...now, name] : now.filter((n) => n !== name) })
  }

  const measure = async (loc: (typeof locations)[number]): Promise<void> => {
    try {
      const terrain = await runJob(
        () => provider.submitTerrainAnalysis({ priority: 'background', site: loc.center, observerHeightM: A.observerHeightM, includeLocalTerrain: true, config: { azimuthStepDeg: s.azimuthStepDeg, maxDistanceKm: s.maxDistanceKm } }, signal),
        (id) => provider.getTerrainAnalysis(id, signal),
        (job) => update({ message: `${loc.name}: ${job.message ?? 'Checking terrain'}` }),
        signal,
      )
      const terrainProblem = terrainIssue(terrain)
      if (terrainProblem) throw new Error(terrainProblem)
      const evaluation = await runJob(
        () => catalogApi.submitRankingEvaluation({ terrainAnalysisId: terrain.id, startUtc: new Date(start).toISOString(), stopUtc: new Date(stop).toISOString(), stepMinutes: s.stepMinutes, minSunFraction }, signal),
        (id) => catalogApi.getRankingEvaluation(id, signal),
        (job) => update({ message: `${loc.name}: ${job.message ?? 'Checking sunlight and visibility'}` }),
        signal,
      )
      if ('skipped' in evaluation) {
        if (evaluation.skipped !== true || evaluation.origin !== 'engine' || evaluation.reason !== 'sunlight_below_threshold'
          || evaluation.terrainAnalysisId !== terrain.id || evaluation.startMs !== start || evaluation.stopMs !== stop
          || evaluation.minSunFraction !== minSunFraction || !Number.isFinite(evaluation.sunFractionUpperBound)
          || evaluation.sunFractionUpperBound < 0 || evaluation.sunFractionUpperBound >= minSunFraction) {
          throw new Error('The sunlight screening result does not match the requested comparison.')
        }
        update({ skipped: add(getState().ranking?.skipped, { id: loc.id, name: loc.name, center: loc.center, sunFractionUpperBound: evaluation.sunFractionUpperBound }) })
        return
      }
      const scenarioProblem = scenarioIssue(evaluation, terrain.id, start, stop, s.stepMinutes * 60_000)
      if (scenarioProblem) throw new Error(scenarioProblem)
      const m = summarize(evaluation, start, stop)
      if (m.sun < minSunFraction) {
        update({ skipped: add(getState().ranking?.skipped, { id: loc.id, name: loc.name, center: loc.center, sunFractionUpperBound: m.sun }) })
        return
      }
      const region: Region = {
        id: loc.id, name: loc.name, area: loc.area, center: loc.center, pointKind: loc.pointKind,
        warnings: [`DEM sampling: ${terrain.profile.dem.effectivePixelSizeM} m`, ...terrain.profile.warnings, ...evaluation.approximations],
        sunFraction: m.sun, earthFraction: m.earth, bothFraction: m.both,
        periodHours: (stop - start) / 3_600_000,
        longestNightH: m.nightH,
        longestNoLinkH: intervalStats(evaluation.intervals.earth, start, stop).longestOffMs / 3_600_000,
        longestBothH: intervalStats(evaluation.intervals.both, start, stop).longestOnMs / 3_600_000,
        localTerrain: terrain.localTerrain,
        demPixelM: terrain.profile.dem.effectivePixelSizeM,
        powerSeries: evaluation.sun.visibleFraction && evaluation.sun.distanceKm ? { timesMs: evaluation.timesMs, visibleFraction: evaluation.sun.visibleFraction, distanceKm: evaluation.sun.distanceKm } : undefined,
        provenance: { terrainId: terrain.id, evaluationId: evaluation.id, startMs: start, stopMs: stop, ephemeris: evaluation.ephemeris.source, productIds: terrain.profile.dem.productIds },
      }
      update({ regions: add(getState().ranking?.regions, region) })
    } catch (err) {
      if (signal.aborted) return
      update({ failed: add(getState().ranking?.failed, { id: loc.id, name: loc.name, center: loc.center, reason: describe(err) }) })
    }
  }

  // Four sites at a time, the engine's worker count; each lane takes the next free site.
  let next = 0
  const lane = async () => {
    while (next < locations.length && !signal.aborted) {
      const loc = locations[next++]
      measuring(loc.name, true)
      try {
        await measure(loc)
      } finally {
        measuring(loc.name, false)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RANKING_PARALLEL, locations.length) }, lane))
  if (signal.aborted) return
  update({ busy: false, current: [], message: null })
}

// Catalog requests retry on their own while the backend restarts (api/retry.ts);
// the panels keep showing "Loading…" meanwhile, and an error only after the retries.
let regionRequest: ReturnType<typeof catalogApi.getRegions> | null = null
let siteRequest: ReturnType<typeof catalogApi.getSites> | null = null

export async function loadRegionCatalog(): Promise<void> {
  setState({ regionError: null })
  try {
    const catalog = provider.kind === 'api'
      ? regionCatalog(await (regionRequest ??= withRetry(() => catalogApi.getRegions())))
      : await loadRegions()
    setState({ regions: catalog })
  } catch (err) {
    regionRequest = null
    setState({ regions: null, regionError: describe(err) })
  }
}

export async function loadSiteCatalog(): Promise<void> {
  if (provider.kind !== 'api') return
  setState({ siteError: null })
  try {
    const sites = siteCatalog(await (siteRequest ??= withRetry(() => catalogApi.getSites())))
    setState({ sites, sitesLoaded: true })
  } catch (err) {
    siteRequest = null
    setState({ sites: [], sitesLoaded: true, siteError: describe(err) })
  }
}

export async function loadCoverage(): Promise<void> {
  try {
    setState({ coverage: await withRetry(() => provider.getCoverage()) })
  } catch {
    setState({ coverage: null })
  }
}
