import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'fixtures/inbox-virtual-scroll.html')
const sourceInbox = readFileSync(join(__dirname, '../src/pages/Inbox.tsx'), 'utf8')
const sourceLayout = readFileSync(join(__dirname, '../src/components/Layout.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function withFixture(run) {
  const html = readFileSync(fixturePath)
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const browser = await chromium.launch()
  try {
    await run(browser, `http://127.0.0.1:${port}/`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

function sourceGuards() {
  assert(
    sourceLayout.includes('isFixedHeightRoute'),
    'Layout must gate overflow for fixed-height routes',
  )
  assert(
    sourceLayout.includes("location.pathname.startsWith('/inbox')"),
    'Layout must treat /inbox as a fixed-height route',
  )
  assert(
    /isFixedHeightRoute \? 'overflow-hidden' : 'overflow-y-auto'/.test(sourceLayout),
    'Layout main must use overflow-hidden on inbox',
  )
  assert(
    sourceInbox.includes('data-testid="inbox-conversation-list"'),
    'Inbox list must expose a test id',
  )
  assert(
    sourceInbox.includes('flex-1 min-h-0 overflow-y-auto overscroll-contain'),
    'Inbox list must be a bounded flex scrollport',
  )
  assert(
    sourceInbox.includes('virtualizer.measureElement'),
    'Inbox virtualizer must measure dynamic row heights',
  )
  assert(
    sourceInbox.includes('root, threshold: 0.1'),
    'Infinite scroll observer must use the list scrollport as root',
  )
  assert(
    !/count:\s*filtered\.length\s*\+\s*\(hasNextPage/.test(sourceInbox),
    'Sentinel must not be a virtual item (must stay mounted)',
  )
  console.log('✓ source guards')
}

async function mobileScrollOwnsList(browser, url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(url)
  const list = page.getByTestId('inbox-conversation-list')
  const main = page.getByTestId('layout-main')
  await list.waitFor()

  const before = await page.evaluate(() => {
    const { list, main } = window.__inboxFixture
    return {
      listClient: list.clientHeight,
      listScroll: list.scrollHeight,
      mainClient: main.clientHeight,
      mainScroll: main.scrollHeight,
      listTop: list.scrollTop,
      mainTop: main.scrollTop,
    }
  })

  assert(before.listScroll > before.listClient, 'list must overflow so virtualization can scroll')
  assert(before.mainScroll <= before.mainClient + 1, 'main must not be the overflowing scroller')

  await list.evaluate((el) => {
    el.scrollTop = 1200
  })
  await page.waitForTimeout(50)

  const after = await page.evaluate(() => {
    const { list, main } = window.__inboxFixture
    const visible = [...list.querySelectorAll('.row')].map((el) => Number(el.dataset.index))
    return {
      listTop: list.scrollTop,
      mainTop: main.scrollTop,
      visible,
    }
  })

  assert(after.listTop >= 1100, `list scrollTop should move (got ${after.listTop})`)
  assert(after.mainTop === 0, `main must stay at scrollTop 0 (got ${after.mainTop})`)
  assert(
    after.visible.some((i) => i >= 10),
    `virtual window should advance after scroll (visible=${after.visible.join(',')})`,
  )
  console.log('✓ mobile list owns scrolling; virtual window advances')
  await page.close()
}

async function main() {
  sourceGuards()
  await withFixture(mobileScrollOwnsList)
  console.log('All inbox virtual scroll e2e checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
