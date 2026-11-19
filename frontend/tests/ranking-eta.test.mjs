import assert from 'node:assert/strict'
import { test } from 'node:test'
import { load } from './load-ts.mjs'

const { rankingEtaLabel, rankingEtaMs } = await load('../src/domain/rankingEta.ts')

const S = 1000

test('no estimate before three sites are processed', () => {
  assert.equal(rankingEtaMs(0, 100 * S, 2, 29), null)
  assert.equal(rankingEtaLabel(0, 100 * S, 0, 29), 'Estimating time…')
  assert.equal(rankingEtaLabel(0, 100 * S, 2, 29), 'Estimating time…')
})

test('estimate is elapsed per processed site times the sites remaining', () => {
  // 3 sites in 30 s -> 10 s each, 26 left -> 260 s.
  assert.equal(rankingEtaMs(0, 30 * S, 3, 29), 260 * S)
  assert.equal(rankingEtaLabel(0, 30 * S, 3, 29), 'about 5 min left')
})

test('minutes round up and short waits say under a minute', () => {
  // 6 sites in 60 s, 6 left -> exactly 60 s.
  assert.equal(rankingEtaLabel(0, 60 * S, 6, 12), 'about 1 min left')
  // 6 sites in 60 s, 5 left -> 50 s.
  assert.equal(rankingEtaLabel(0, 60 * S, 6, 11), 'under 1 min left')
  // 3 sites in 31 s, 26 left -> about 268 s, 4.5 min.
  assert.equal(rankingEtaLabel(0, 31 * S, 3, 29), 'about 5 min left')
})

test('the label is empty when the run is complete', () => {
  assert.equal(rankingEtaLabel(0, 100 * S, 29, 29), '')
  assert.equal(rankingEtaMs(0, 100 * S, 29, 29), null)
})
