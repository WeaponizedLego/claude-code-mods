import { expect, test } from 'claude-code/testing'

const band = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 9 }, view: {} },
})

test('the band shows context, cost, tokens and limits in theme colours', async ($, on) => {
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

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, ...band(140) })

    expect((await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe('success')
    expect((await ui.find({ type: 'Text', text: /^\$/ }))?.text).toBe('$1.27')
    expect((await ui.find({ type: 'Text', text: '4.1k' }))?.text).toBe('4.1k')
    expect((await ui.find({ type: 'Text', text: '91%' }))?.props.color).toBe('error')
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.source)).toContain('rx="4" fill="#0ca30c"')
      expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
    } else {
      expect((await ui.find({ type: 'Text', text: /^█+$/ }))?.props.color).toBe('success')
    }
    await ui.unmount()
  }
})

test('the context turns orange from 70% and red past 80%', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const colourAt = async (percent: number) => {
    await $.session.measure({ context: { tokens: percent * 2000, window: 200_000, percent }, rateLimits: [], changed: ['context'] })
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(140) })
    const colour = (await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color
    await ui.unmount()
    return colour
  }

  expect(await colourAt(69)).toBe('success')
  expect(await colourAt(70)).toBe('#ff8700')
  expect(await colourAt(80)).toBe('#ff8700')
  expect(await colourAt(81)).toBe('error')
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
  expect((await ui.find({ type: 'Text', text: /^ \d+%$/ }))?.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: /^\$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d ' })).toBeUndefined()
})
