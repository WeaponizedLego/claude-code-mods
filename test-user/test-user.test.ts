import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { C as LOOK } from './hooks/look'

const pane = (bodyColumns = 80) => ({
  component: 'Pane' as const,
  requestId: 'test-user',
  props: { title: 'Test user', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
})

// Stands in for the surface and the Agent tool: panes open, the tester starts as a1.
const surface = (on: On) => {
  on('ui.open', () => ({ value: { isPlaced: true as const } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

const call = ($: any, tool: string, args: Record<string, unknown>, agentId: string | null = 'a1') =>
  $.tool.call({ tool: `mcp__test-user__${tool}`, ...(agentId ? { agentId } : {}), ...args } as never)

test('a tester run fills its tasks and findings and ends with the verdict', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  surface(on)

  await $.agent.spawn({ subagentType: 'test-user:tester', prompt: 'Test the new checkout flow at http://localhost:5173', description: 'Test checkout' } as never)

  const planned = await call($, 'test_plan', {
    target: 'Checkout · localhost:5173',
    scope: 'feature',
    tasks: ['Add an item to the cart', 'Change the quantity', 'Pay with the test card'],
  })
  expect(String(planned.result)).toContain('1. Add an item to the cart')

  await clock.advance(60_000)
  await call($, 'test_task', { task: 1, status: 'passed' })
  await call($, 'test_finding', { severity: 'major', title: 'Quantity resets on blur', detail: 'Typed 3, tabbed away, it went back to 1.', where: '/cart' })
  const failed = await call($, 'test_task', { task: 2, status: 'failed', note: 'Quantity cannot be changed' })
  expect(String(failed.result)).toContain('Now on task 3')

  const wrong = await call($, 'test_task', { task: 9, status: 'passed' })
  expect(wrong.deny).toContain('no task 9')

  for (const s of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'test-user', surface: s, ...pane() })
    if (s === 'terminal') {
      expect(await ui.find({ type: 'Text', text: 'Checkout · localhost:5173' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' Testing' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: 'Pay with the test card' }))?.props.bold).toBe(true)
      expect((await ui.find({ type: 'Text', text: '  Quantity cannot be changed' }))?.props.color).toBe(LOOK.hot)
      expect(await ui.find({ type: 'Text', text: 'Quantity resets on blur' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: ' MAJOR' }))?.props.color).toBe(LOOK.warn)
    } else {
      const svg = String((await ui.find({ type: 'Svg' }))?.props.source)
      expect(svg).toContain('Checkout · localhost:5173')
      expect(svg).toContain('Quantity resets on blur')
      expect(svg).toContain('MAJOR')
      expect(svg).toContain('1 major')
      expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('1 of 3 tasks passed, 1 failed, 1 finding')
    }
    await ui.unmount()
  }

  // The tester ends its turn without calling test_finish: the record decides.
  await ($ as any).turn.complete({ answer: 'Checkout mostly works but quantity is broken.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1', reason: 'answer' })

  const rep = await call($, 'test_report', {}, null)
  expect(String(rep.result)).toContain('Issues found: Checkout · localhost:5173 (feature, by Haiku test user')
  expect(String(rep.result)).toContain('3. [-] Pay with the test card (not reached)')
  expect(String(rep.result)).toContain('MAJOR [task 2]: Quantity resets on blur @ /cart')
  expect(String(rep.result)).toContain('Summary: Checkout mostly works')
})

test('a tester resumed after its turn ended carries on with the same run', async ($, on) => {
  mock.clock(on, { now: 0 })
  surface(on)
  await $.agent.spawn({ subagentType: 'test-user:tester', prompt: 'Test the app' } as never)
  await call($, 'test_plan', { target: 'Vively', tasks: ['Onboard', 'Record a headache', 'Open the calendar'] })
  await call($, 'test_task', { task: 1, status: 'passed' })
  await ($ as any).turn.complete({ answer: 'Paused.', durationMs: 1, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })

  // Resumed: its updates reopen the run instead of being refused.
  const late = await call($, 'test_task', { task: 2, status: 'passed' })
  expect(late.deny).toBeUndefined()
  expect(String(late.result)).toContain('Now on task 3')
  await call($, 'test_finding', { severity: 'minor', title: 'Legend omits medication' })
  // Sending the same plan again keeps what was done.
  const again = await call($, 'test_plan', { target: 'Vively', tasks: ['Onboard', 'Record a headache', 'Open the calendar'] })
  expect(String(again.result)).toContain('1. Onboard (passed)')
  await call($, 'test_task', { task: 3, status: 'passed' })
  await call($, 'test_finish', { verdict: 'passed', summary: 'Works.' })

  const rep = String((await call($, 'test_report', {}, null)).result)
  expect(rep).toContain('Issues found')
  expect(rep).toContain('3 passed, 0 failed, 3 total')
  expect(rep).toContain('Legend omits medication')

  // Claude amends the tester's run with its own re-check: the run stays ended.
  await call($, 'test_finding', { severity: 'major', title: 'Bleeding sheet ignores saved value' }, null)
  const amended = String((await call($, 'test_report', {}, null)).result)
  expect(amended).toContain('MAJOR: Bleeding sheet ignores saved value')
  expect(amended).toContain('Issues found')
})

test('the session gets the full record: on the Agent result, else on the next prompt', async ($, on) => {
  mock.clock(on, { now: 0 })
  surface(on)
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'completed', content: [{ type: 'text', text: 'Pay is broken.' }] } as never }))

  // A foreground Agent call: the tester (spawned under the call's id) runs and
  // ends before the call returns; the kit plays those steps first.
  await $.agent.spawn({ subagentType: 'test-user:tester', prompt: 'Test checkout', tool_use_id: 'tu1' } as never)
  await call($, 'test_plan', { target: 'Checkout', tasks: ['Pay'] })
  await call($, 'test_task', { task: 1, status: 'failed', note: 'Pay button dead' })
  await ($ as any).turn.complete({ answer: 'Pay is broken.', durationMs: 1, isAborted: false, turnId: 't', agentId: 'a1', reason: 'answer' })
  const ran = await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', subagent_type: 'test-user:tester', prompt: 'Test checkout', description: 'Test checkout' } as never)
  expect(String(ran.context?.[0])).toContain('test-user results')
  expect(String(ran.context?.[0])).toContain('1. [!] Pay — Pay button dead')

  // Delivered once: the next prompt carries nothing more.
  const quiet = await $.prompt.submit({ text: 'thanks' } as never)
  expect('context' in quiet ? quiet.context ?? [] : []).toHaveLength(0)

  // A background tester's run ends unseen: the next prompt (its notification) carries it.
  await $.agent.spawn({ subagentType: 'test-user:tester', prompt: 'Test settings' } as never)
  await call($, 'test_plan', { target: 'Settings', tasks: ['Toggle dark mode'] })
  await call($, 'test_task', { task: 1, status: 'passed' })
  await ($ as any).turn.complete({ answer: 'All fine.', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  const next = await $.prompt.submit({ text: 'how did it go?' } as never)
  const context = 'context' in next ? (next.context ?? []) : []
  expect(context).toHaveLength(1)
  expect(String(context[0])).toContain('Passed: Settings')
})

test('a blocked run shows why, and Claude can record a run of its own', async ($, on) => {
  mock.clock(on, { now: 0 })
  surface(on)

  await $.agent.spawn({ subagentType: 'test-user:tester', prompt: 'Test the application' } as never)
  await call($, 'test_finish', { verdict: 'blocked', summary: 'Nothing listens on localhost:3000.', reason: 'Nothing listens on localhost:3000 and there is no launch.json.' })

  const term = await $.ui.mount({ plugin: 'test-user', surface: 'terminal', ...pane() })
  expect(await term.find({ type: 'Text', text: 'Could not test' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'Nothing listens on localhost:3000 and there is no launch.json.' })).toBeDefined()
  await term.unmount()

  // The main loop (no agentId) starts its own run with test_plan.
  await call($, 'test_plan', { tasks: ['Open settings', 'Toggle dark mode'], target: 'Settings' }, null)
  await call($, 'test_task', { task: 1, status: 'passed' }, null)
  await call($, 'test_task', { task: 2, status: 'passed' }, null)
  const done = await call($, 'test_finish', { verdict: 'passed', summary: 'All good.' }, null)
  expect(String(done.result)).toContain('Passed')

  const desk = await $.ui.mount({ plugin: 'test-user', surface: 'desktop', ...pane(60) })
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('by Claude')
  expect(svg).toContain('Earlier: Test the application')
  await desk.unmount()
})

test('a verdict of passed does not hide a failed task', async ($, on) => {
  mock.clock(on, { now: 0 })
  surface(on)
  await call($, 'test_plan', { tasks: ['Log in'] }, null)
  await call($, 'test_task', { task: 1, status: 'failed', note: 'Button does nothing' }, null)
  await call($, 'test_finish', { verdict: 'passed', summary: 'Fine.' }, null)
  const rep = await call($, 'test_report', {}, null)
  expect(String(rep.result)).toContain('Issues found')
})

test('the pane says how to start when there is no run', async ($, on) => {
  mock.clock(on, { now: 0 })
  for (const s of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'test-user', surface: s, ...pane() })
    if (s === 'terminal') expect(await ui.find({ type: 'Text', text: 'No test run yet' })).toBeDefined()
    else expect(String((await ui.find({ type: 'Svg' }))?.props.source)).toContain('No test run yet')
    await ui.unmount()
  }
})
