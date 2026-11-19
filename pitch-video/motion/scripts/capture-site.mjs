import { chromium } from 'playwright'
const BASE = process.env.APP_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const shot = async (name, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `public/shots/${name}.png` }); console.log('shot', name) }
await page.goto(`${BASE}/#/`)
await page.waitForTimeout(5000)
await page.getByRole('button', { name: 'Mission Planner', exact: true }).first().click()
await page.getByLabel('Part of the Moon in view').getByRole('button', { name: 'South pole', exact: true }).click()
await page.waitForTimeout(3000)
await page.getByRole('button', { name: /^Compare sites for/ }).click()
await page.waitForTimeout(8000)
for (let i = 0; i < 40 && !(await page.locator('button.rank-row', { hasText: 'Peak Near Shackleton' }).count()); i++) await page.waitForTimeout(2000)
await page.locator('button.rank-row', { hasText: 'Peak Near Shackleton' }).first().click()
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /Open the horizon/ }).click()
for (let i = 0; i < 60; i++) { if (await page.getByText(/Day 1 of/).count()) break; await page.waitForTimeout(2000) }
await shot('site', 3000)
for (const a of ['Educator', 'General Public']) {
  await page.getByRole('button', { name: a, exact: true }).first().click()
  await shot(`site-${a.toLowerCase().replace(' ', '-')}`, 6000)
}
await page.getByRole('button', { name: 'Mission Planner', exact: true }).first().click()
await shot('site', 5000)
await page.getByRole('button', { name: /^Compare$/ }).first().click()
await shot('compare', 4000)
await browser.close()
