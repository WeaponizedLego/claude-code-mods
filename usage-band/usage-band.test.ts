import { expect, test } from 'claude-code/testing'

import { C } from './hooks/look'

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 9 }, view: {} },
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
  expect((await term.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe(C.accent)
  expect((await term.find({ type: 'Text', text: /^\$/ }))?.text).toBe('$1.27')
  expect((await term.find({ type: 'Text', text: '4.1k' }))?.text).toBe('4.1k')
  expect((await term.find({ type: 'Text', text: '91%' }))?.props.color).toBe(C.hot)
  expect((await term.find({ type: 'Text', text: /^▰+$/ }))?.props.color).toBe(C.accent)
  await term.unmount()

  // The desktop draws a strip of stat tiles, one image.
  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(140) })
  const svg = await desk.find({ type: 'Svg' })
  const source = String(svg?.props.source)
  expect(source).toContain(`fill="${C.accent}" letter-spacing="-0.3">48%<`)
  expect(source).toContain('>$1.27<')
  expect(source).toContain('>4.1k<')
  expect(source).toContain('2.0k in')
  expect(source).toContain(`fill="${C.hot}" letter-spacing="-0.3">91%<`)
  expect(String(svg?.props.alt)).toContain('Context 48% 96k / 200k')
  expect(await desk.find({ type: 'Text' })).toBeUndefined()
  await desk.unmount()
})

test('the context turns orange from 70% and red past 80%', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const colourAt = async (percent: number) => {
    await $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(140) })
    const colour = (await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color
    await ui.unmount()
    return colour
  }

  expect(await colourAt(69)).toBe(C.accent)
  expect(await colourAt(70)).toBe(C.warn)
  expect(await colourAt(80)).toBe(C.warn)
  expect(await colourAt(81)).toBe(C.hot)
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
  expect((await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe(C.hot)
  expect(await ui.find({ type: 'Text', text: /^\$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d ' })).toBeUndefined()
  await ui.unmount()

  // A narrow desktop band keeps the context and cost tiles and drops the limit.
  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(32) })
  const source = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(source).toContain('>Context<')
  expect(source).toContain('>Cost<')
  expect(source).not.toContain('7d limit')
})

test('a band too short for tiles falls back to the text row on the desktop', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { tokens: 20_000, window: 200_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(140), props: { ...band(140).props, maxRows: 1 } })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: ' 10%' }))?.props.color).toBe(C.accent)
})
