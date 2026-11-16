import { useSyncExternalStore } from 'react'
import type { CoverageCatalog, ScenarioEvaluation, SiteCoordinates, TerrainAnalysis } from '../api/types'
import type { AreaFilter, Region, RegionCatalog } from '../domain/ranking'
import { EXAMPLE_SITES } from '../domain/sites'
import type { ExampleSite } from '../domain/sites'
import { provider } from '../api'
import { plannerContext } from '../domain/planner'
import { DEFAULT_MISSION, missionIssue, type MissionProfile } from '../domain/mission'

export type ScenarioKey = 'A' | 'B'

/** Who is reading: the whole tool adapts its copy, density and data. */
export type Audience = 'public' | 'educator' | 'planner'
export const AUDIENCES: { id: Audience; label: string; hint: string }[] = [
  { id: 'planner', label: 'Mission Planner', hint: 'Compare sites by date and inspect full technical data.' },
  { id: 'educator', label: 'Educator', hint: 'Demonstrate why sites are more or less favorable using comparisons and visual evidence.' },
  { id: 'public', label: 'General Public', hint: 'Choose a site and a date to explore its characteristics.' },
]

export type Screen = 'moon' | 'explore' | 'site' | 'compare' | 'kit'

/** Period summary used to compare sites. Fractions 0..1, night in hours. */
export interface SiteSummary {
  sun: number
  earth: number
  both: number
  nightH: number
  earthOutageH?: number
  jointWindowH?: number
}

export interface Comparison {
  key: string
  busy: boolean
  items: { name: string; now: SiteSummary; prev: SiteSummary | null }[]
}

/**
 * Candidate regions measured for the chosen period, so they can be ranked
 * best to worst. Filled one region at a time as the engine answers.
 */
export interface RegionRanking {
  key: string
  busy: boolean
  /** Regions to measure, in catalog order. */
  total: number
  /** Measured regions (Sun, Earth, both, longest night). */
  regions: Region[]
  /** Catalog points that could not be evaluated, with an explicit reason. */
  failed: { id: string; name: string; reason: string; center: SiteCoordinates }[]
  /** Valid points rejected by the minimum sunlight requirement, not data failures. */
  skipped: { id: string; name: string; sunFractionUpperBound: number; center: SiteCoordinates }[]
  /** Names of the regions being measured now (several at once). */
  current: string[]
  /** Current engine stage, including the early sunlight screen. */
  message?: string | null
}

export interface ScenarioInput {
  site: SiteCoordinates
  /** Name of the example site when chosen from the list; null for free picks. */
  siteName: string | null
  selectionId?: string | null
  observerHeightM: number
  startMs: number
}

export type RunPhase = 'idle' | 'terrain' | 'ephemeris' | 'ready' | 'error'

export interface ScenarioRun {
  phase: RunPhase
  progress?: number
  /** Terrain becomes available independently of the subsequent scenario evaluation. */
  terrain?: TerrainAnalysis
  evaluation?: ScenarioEvaluation
  /** Same length of time just before the start, for "vs last month". */
  previous?: ScenarioEvaluation
  /** True while the shown results no longer match the inputs. */
  stale: boolean
  error?: string
  message?: string
}

export interface Scenario {
  input: ScenarioInput
  run: ScenarioRun
}

/** Most sites the compare screen shows side by side. */
export const COMPARE_MAX = 4

/** One site on the compare screen. Slot order gives the letters A–D. */
export interface CompareSite {
  startMs?: number
  horizonMode?: 'terrain' | 'ideal'
  key: string
  name: string
  site: SiteCoordinates
}

export type CompareView = 'circle' | 'sun'

/** One General Public try: where, when, and the grade it earned. */
export interface Attempt {
  id: string
  input: ScenarioInput
  config: {
    durationDays: number
    stepMinutes: number
    azimuthStepDeg: number
    maxDistanceKm: number
    observerHeightM: number
    origin: string
    model: string
    ephemerisVersion: string
    terrainVersion: string
    scoringVersion: string
  }
  metrics: SiteSummary
  evaluationId: string
  site: SiteCoordinates
  name: string
  startMs: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  index: number
}

/** Educator experiment switches on the compare screen. */
export interface ExperimentState {
  mode: 'sites' | 'dates' | 'terrain'
  secondStartMs?: number
  /** Preset being demonstrated, or null for a free choice of sites. */
  id: string | null
  /** Dots tracing the Sun and Earth over the period. */
  trails: boolean
}

/** Skyline only: what the site picker needs to preview a site. */
export interface Skyline {
  azimuthDeg: number[]
  elevationDeg: number[]
}

export function siteKey(site: SiteCoordinates): string {
  return `${site.latDeg.toFixed(4)},${site.lonEastDeg.toFixed(4)}`
}

export interface PlannerExperiment {
  pointShown: boolean
  mission: MissionProfile
  input: ScenarioInput
  context: string
  durationDays: number
  stepMinutes: number
  azimuthStepDeg: number
  maxDistanceKm: number
  area: AreaFilter
  baseline: Region
}

export interface AppState {
  plannerExperiment: PlannerExperiment | null
  screen: Screen
  audience: Audience
  scenarios: Record<ScenarioKey, Scenario>
  active: ScenarioKey
  compare: boolean
  durationDays: number
  stepMinutes: number
  azimuthStepDeg: number
  maxDistanceKm: number
  cursorOffsetMs: number
  playing: boolean
  /** Simulated hours per real second during playback. */
  speed: number
  coverage: CoverageCatalog | null
  regions: RegionCatalog | null
  sites: ExampleSite[]
  sitesLoaded: boolean
  regionError: string | null
  siteError: string | null
  /** Top regions of the ranking, computed for the same period as scenario A. */
  comparison: Comparison | null
  /** Candidate regions measured for scenario A's period (engine only). */
  ranking: RegionRanking | null
  mission: MissionProfile
  /** Whether a point is chosen on the Moon. False at start and after it is removed. */
  pointShown: boolean
  area: AreaFilter
  /** Incremented to ask the globe to fly to a scenario. */
  flyRequest: { key: ScenarioKey; nonce: number } | null
  /** Sites on the compare screen, in slot order (A–D). */
  compareSites: CompareSite[]
  /** One run per compared site, keyed by `siteKey`, with the inputs it was made for. */
  compareRuns: Record<string, ScenarioRun & { runKey: string }>
  compareView: CompareView
  pickerOpen: boolean
  /** Horizon outlines already known, keyed by `siteKey`, for the picker previews. */
  skylines: Record<string, Skyline>
  /** General Public tries this visit, oldest first. */
  attempts: Attempt[]
  experiment: ExperimentState
}

const startOfTodayUtc = (() => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
})()

const first = EXAMPLE_SITES[0]
const second = EXAMPLE_SITES[2]

function storedAudience(): Audience {
  try {
    const v = localStorage.getItem('meowrizon.audience')
    if (v === 'planner' || v === 'educator') return v
    if (v === 'teacher') return 'educator'
    if (v === 'public' || v === 'student') return 'public'
  } catch {
    // Storage unavailable (private mode, blocked site data): use the default.
  }
  return 'public'
}

/** Requirements are no longer set in the interface: every session starts from the general defaults. */
function storedMission(): MissionProfile {
  try { localStorage.removeItem('meowrizon.mission.v1') } catch { /* Storage is optional. */ }
  return structuredClone(DEFAULT_MISSION)
}

export function screenFromHash(hash: string): Screen {
  if (hash.startsWith('#/site')) return 'site'
  if (hash.startsWith('#/compare')) return 'compare'
  if (hash.startsWith('#/kit')) return 'kit'
  if (hash.startsWith('#/explore')) return 'explore'
  return 'moon'
}

const initialState: AppState = {
  screen: screenFromHash(typeof location === 'undefined' ? '' : location.hash),
  audience: storedAudience(),
  scenarios: {
    A: {
      input: { site: { latDeg: first.latDeg, lonEastDeg: first.lonEastDeg }, siteName: provider.kind === 'demo' ? first.name : null, observerHeightM: 2, startMs: startOfTodayUtc },
      run: { phase: 'idle', stale: true },
    },
    B: {
      input: { site: { latDeg: second.latDeg, lonEastDeg: second.lonEastDeg }, siteName: provider.kind === 'demo' ? second.name : null, observerHeightM: 2, startMs: startOfTodayUtc },
      run: { phase: 'idle', stale: true },
    },
  },
  active: 'A',
  compare: false,
  durationDays: 30,
  stepMinutes: 30,
  azimuthStepDeg: 0.5,
  maxDistanceKm: 150,
  cursorOffsetMs: 0,
  playing: false,
  speed: 12,
  coverage: null,
  regions: null,
  sites: provider.kind === 'demo' ? EXAMPLE_SITES : [],
  sitesLoaded: provider.kind === 'demo',
  regionError: null,
  siteError: null,
  comparison: null,
  ranking: null,
  mission: storedMission(),
  pointShown: false,
  area: 'all',
  flyRequest: null,
  compareSites: [],
  compareRuns: {},
  compareView: 'circle',
  pickerOpen: false,
  skylines: {},
  attempts: [],
  plannerExperiment: null,
  experiment: { id: null, mode: 'sites', trails: true },
}

type Listener = () => void

let state = initialState
const listeners = new Set<Listener>()

export function getState(): AppState {
  return state
}

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const patch = typeof update === 'function' ? update(state) : update
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function setMission(mission: MissionProfile): void {
  const issue = missionIssue(mission)
  if (issue) throw new Error(issue)
  setState({ mission })
}

export function updateScenario(key: ScenarioKey, fn: (s: Scenario) => Scenario): void {
  setState((s) => ({ scenarios: { ...s.scenarios, [key]: fn(s.scenarios[key]) } }))
}

export function setScenarioInput(key: ScenarioKey, patch: Partial<ScenarioInput>): void {
  if (patch.site && !('selectionId' in patch)) patch = { ...patch, selectionId: null }
  updateScenario(key, (s) => ({ input: { ...s.input, ...patch }, run: { phase: 'idle', stale: true } }))
  if (key === 'A' && patch.site) setState({ pointShown: true })
}

/** Removes the chosen point from the Moon: nothing is selected until the next pick. */
export function clearPoint(): void {
  updateScenario('A', (s) => ({ ...s, input: { ...s.input, siteName: null, selectionId: null } }))
  setState({ pointShown: false })
}

export function setAudience(audience: Audience): void {
  try {
    localStorage.setItem('meowrizon.audience', audience)
  } catch {
    // Not persisted; the choice still applies to this visit.
  }
  setState({ audience })
}

export function goTo(screen: Screen): void {
  const hash = screen === 'moon' ? '#/' : `#/${screen}`
  if (location.hash !== hash) history.pushState(null, '', hash)
  // Plan and results share one layout and one Moon window: no transition to run.
  setState({ screen, playing: false })
  window.scrollTo(0, 0)
}

function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Selectors must return stable references (primitives or stored objects). */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function durationMs(s: AppState): number {
  return s.durationDays * 86_400_000
}

/** Restore all inputs of a recorded public choice; the engine verifies it again. */
export function reopenAttempt(id: string): void {
  const attempt = getState().attempts.find(t => t.id === id)
  if (!attempt) return
  const { durationDays, stepMinutes, azimuthStepDeg, maxDistanceKm } = attempt.config
  setState({ durationDays, stepMinutes, azimuthStepDeg, maxDistanceKm, cursorOffsetMs: 0 })
  setScenarioInput('A', structuredClone(attempt.input))
  goTo('site')
}

/** Reopening or remeasuring a choice updates its evidence, not the try count. */
export function recordAttempt(attempt: Attempt): void {
  const found = state.attempts.find(t => t.id === attempt.id)
  if (found?.evaluationId === attempt.evaluationId) return
  setState({ attempts: found ? state.attempts.map(t => t.id === attempt.id ? attempt : t) : [...state.attempts, attempt] })
}

/** Pin the current decision while the existing requirement controls are explored. */
export function beginPlannerExperiment(baseline: Region): void {
  const s = getState()
  setState({ plannerExperiment: structuredClone({
    mission: s.mission, input: s.scenarios.A.input, pointShown: s.pointShown, context: plannerContext(s),
    durationDays: s.durationDays, stepMinutes: s.stepMinutes, azimuthStepDeg: s.azimuthStepDeg,
    maxDistanceKm: s.maxDistanceKm, area: s.area, baseline,
  }) })
}

export function restorePlannerExperiment(): void {
  const saved = getState().plannerExperiment
  if (!saved) return
  setState({ durationDays: saved.durationDays, stepMinutes: saved.stepMinutes,
    azimuthStepDeg: saved.azimuthStepDeg, maxDistanceKm: saved.maxDistanceKm,
    area: saved.area, cursorOffsetMs: 0, plannerExperiment: null })
  setMission(structuredClone(saved.mission))
  setScenarioInput('A', structuredClone(saved.input))
  setState({ pointShown: saved.pointShown })
}
