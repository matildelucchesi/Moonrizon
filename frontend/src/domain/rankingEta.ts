/** Sites that must be processed before the pace says anything useful. */
export const ETA_MIN_PROCESSED = 3

/**
 * Time left for the ranking, from the pace so far: elapsed / processed * remaining.
 * The backend gives no estimate. null until enough sites are processed or when nothing remains.
 * Sites served from the engine cache return at once, so early estimates can be pessimistic.
 */
export function rankingEtaMs(startedAt: number, now: number, processed: number, total: number): number | null {
  const remaining = total - processed
  if (processed < ETA_MIN_PROCESSED || remaining <= 0) return null
  return (Math.max(0, now - startedAt) / processed) * remaining
}

/** The header text for an estimate: "Estimating time…", "about 3 min left" or "under 1 min left". */
export function formatRankingEta(ms: number | null): string {
  if (ms === null) return 'Estimating time…'
  if (ms < 60_000) return 'under 1 min left'
  return `about ${Math.ceil(ms / 60_000)} min left`
}

/** Both steps in one: '' when the run is complete. */
export function rankingEtaLabel(startedAt: number, now: number, processed: number, total: number): string {
  if (total - processed <= 0) return ''
  return formatRankingEta(rankingEtaMs(startedAt, now, processed, total))
}
