import type { RenderElement } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { parseWorktrees } from './hooks/git'
import { C, bandSvg } from './hooks/look'
import { fit, segments } from './hooks/register'

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 9 }, view: {} },
})

test('the band shows context, cost, tokens and limits in the palette', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', (_$, e) => ({ text: e.answer, usage: e.usage }))

  await $.session.measure({
    context: { tokens: 96_000, window: 200_000, percent: 48 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 91 }],
    cost: { usd: 1.27 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  await $.turn.complete({
    answer: 'done',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'end_turn',
    usage: { model: 'claude-opus-5-5', input_tokens: 1200, cache_creation_input_tokens: 800, cache_read_input_tokens: 50_000, output_tokens: 4100 },
  } as never)

  const term = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(140) })
  expect((await term.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe(C.text)
  expect((await term.find({ type: 'Text', text: /^\$/ }))?.text).toBe('$1.27')
  expect((await term.find({ type: 'Text', text: '4.1k' }))?.text).toBe('4.1k')
  expect((await term.find({ type: 'Text', text: '91%' }))?.props.color).toBe(C.hot)
  expect((await term.find({ type: 'Text', text: /^━+$/ }))?.props.color).toBe(C.done)
  await term.unmount()

  // The desktop draws a strip of stat tiles, one image: arc gauges and light numerals in a sans.
  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(140) })
  const svg = await desk.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  const alt = String(svg?.props.alt)
  expect(source).toContain('Barlow')
  expect(source).toContain('>CONTEXT %<')
  expect(source).toContain(`stroke="${C.done}" stroke-width="3"`)
  expect(source).toContain('2.0k in')
  // The limit past 90% is drawn in red and its tile gets the red stroke; tiles are square.
  expect(source).toContain(`stroke="${C.hot}" stroke-width="3"`)
  expect(source).toContain(`fill="${C.card}" stroke="${C.hot}"`)
  expect(source).not.toContain('rx=')
  expect(source).not.toMatch(/Gradient|url\(#/)
  expect(alt).toContain('Context 48% 96k / 200k')
  expect(alt).toContain('Cost $1.27')
  expect(alt).toContain('Tokens 4.1k out')
  expect(alt).toContain('5h limit 91%')
  expect(await desk.find({ type: 'Text' })).toBeUndefined()
  await desk.unmount()
})

test('the context turns amber from 70% and red past 90%', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const colourAt = async (percent: number) => {
    await $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(140) })
    const colour = (await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color
    await ui.unmount()
    return colour
  }

  expect(await colourAt(69)).toBe(C.text)
  expect(await colourAt(70)).toBe(C.accent)
  expect(await colourAt(90)).toBe(C.accent)
  expect(await colourAt(91)).toBe(C.hot)
})

test('a narrow band keeps the context bar and the cost', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 170_000, window: 200_000, percent: 85 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 12 }],
    cost: { usd: 3.5 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(40) })
  expect((await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe(C.accent)
  expect(await ui.find({ type: 'Text', text: /^\$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d ' })).toBeUndefined()
  await ui.unmount()

  // A narrow desktop band keeps the context and cost tiles and drops the limit.
  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(40) })
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('>CONTEXT %<')
  expect(source).toContain('>COST<')
  expect(source).not.toContain('7D LIMIT')
})

test('a band too short for tiles falls back to the text row on the desktop', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(140), props: { ...band(140).props, maxRows: 1 } })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: ' 10%' }))?.props.color).toBe(C.text)
})

test('a band beneath this one draws under the usage row', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Stands for branch-band, a mod beneath usage-band.
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, 'feature/PLAT-1') as RenderElement)
  await $.session.measure({ context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits: [], changed: ['context'] })

  const term = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(140) })
  expect((await term.find({ type: 'Text', text: ' 10%' }))?.text).toBe(' 10%')
  expect((await term.find({ type: 'Text', text: 'feature/PLAT-1' }))?.text).toBe('feature/PLAT-1')
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(140) })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect((await desk.find({ type: 'Text', text: 'feature/PLAT-1' }))?.text).toBe('feature/PLAT-1')
  await desk.unmount()
})

const PORCELAIN = `worktree /Users/me/repo
HEAD 1111111
branch refs/heads/develop

worktree /Users/me/repo-wt/CD-4458
HEAD 2222222
branch refs/heads/feature/CD-4458_implement-mailgun-mail-api-replacement

worktree /Users/me/repo-wt/scratch
HEAD 3333333
detached
`
const GIT = {
  branch: 'feature/CD-4458_implement-mailgun-mail-api-replacement',
  worktrees: parseWorktrees(PORCELAIN, '/Users/me/repo-wt/CD-4458'),
}

test('worktrees parse, the current one marked', async () => {
  expect(GIT.worktrees.map(w => [w.branch, w.isCurrent])).toEqual([
    ['develop', false],
    ['feature/CD-4458_implement-mailgun-mail-api-replacement', true],
    ['detached', false],
  ])
})

test('the desktop strip gets a Branch panel under the tiles when the band has the rows', async () => {
  const snap = { contextTokens: 357_000, window: 1_000_000, percent: 36, costUsd: 20.2, limits: [{ kind: 'five_hour', percentUsed: 50 }] }
  const used = { input: 352_000, output: 93_000, cacheRead: 24_900_000 }

  const strip = bandSvg(snap, used, 932, GIT, 6)
  expect(strip.height).toBe(64 + 8 + 24)
  expect(strip.source).toContain('>BRANCH<')
  expect(strip.source).toContain('feature/CD-4458_implement-mailgun-mail-api-replacement')
  expect(strip.source).toContain('2 other worktrees: repo, scratch')
  expect(strip.alt).toContain('Branch feature/CD-4458')

  // Too few rows, or no repository: the tiles alone.
  expect(bandSvg(snap, used, 932, GIT, 3).height).toBe(64)
  expect(bandSvg(snap, used, 932, null, 6).source).not.toContain('BRANCH')

  // A narrow strip cuts the branch and drops the worktree list rather than overflow.
  const narrow = bandSvg(snap, used, 300, GIT, 6)
  expect(narrow.source).toContain('…')
  expect(narrow.source).not.toContain('other worktree')
  // A middling strip keeps the whole branch and says how many worktrees, not a cut list.
  const middling = bandSvg(snap, used, 600, GIT, 6).source
  expect(middling).toContain('feature/CD-4458_implement-mailgun-mail-api-replacement<')
  expect(middling).toContain('+2 worktrees')
})

test('the terminal row ends with the branch, the first segment dropped when short of room', async () => {
  const snap = { contextTokens: 20_000, window: 200_000, percent: 10, costUsd: 1.5, limits: [] }
  const used = { input: 0, output: 0, cacheRead: 0 }
  const text = (cols: number) => fit(segments(snap, used, GIT), cols).map(r => r.text).join('')

  expect(text(140)).toContain('⎇ feature/CD-4458_implement-mailgun-mail-… +2 worktrees')
  expect(text(40)).not.toContain('⎇')
  expect(fit(segments(snap, used, null), 140).map(r => r.text).join('')).not.toContain('⎇')
})
