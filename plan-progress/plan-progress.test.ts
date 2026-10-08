import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { C as LOOK } from './hooks/look'

const pane = (bodyRows = 30) => ({
  component: 'Pane' as const,
  requestId: 'plan-progress',
  props: { title: 'Plan progress', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
})

const PLAN = `# Plan: Move auth to sessions

## Context
- Tokens leak into logs today.

## Phase 1: Setup
1. Add the sessions table
2. Write the session store

## Phase 2: Switch over
- Replace token checks in the middleware
- Update the login endpoint
- Remove the old token helpers

## Phase 3: Verify
- Run the auth test suite
`


// Stands in for the surface: panes open, status lines and toasts land.
const surface = (on: On) => {
  on('ui.open', () => ({ value: { isPlaced: true as const } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
}

const approve = (on: On, plan: string, isError = false) => {
  surface(on)
  on('tool.call', { tool: 'ExitPlanMode' }, () =>
    isError ? ({ isError: true, result: undefined, text: 'rejected' } as never) : { result: { plan, isAgent: false } as never },
  )
}

test('an approved plan becomes a tree of phases and steps, the first step current', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  approve(on, PLAN)

  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context?.[0]).toContain('1.1 [>] Add the sessions table')
  expect(ran.context?.[0]).toContain('3 phases, 6 steps')

  const term = await $.ui.mount({ plugin: 'plan-progress', surface: 'terminal', ...pane() })
  expect(await term.find({ type: 'Text', text: 'Move auth to sessions' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'Switch over' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'Context' })).toBeUndefined()
  // The current step is bright and bold inside the current phase's frame.
  expect((await term.find({ type: 'Text', text: 'Add the sessions table' }))?.props.bold).toBe(true)
  expect((await term.find({ type: 'Text', text: 'Run the auth test suite' }))?.props.color).toBe(LOOK.muted)
  expect((await term.find({ type: 'Box', key: 'now-0' }))?.props.borderStyle).toBe('round')
  await term.unmount()

  // The desktop draws the pane as one image of cards.
  const desk = await $.ui.mount({ plugin: 'plan-progress', surface: 'desktop', ...pane() })
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('Move auth to sessions')
  expect(svg).toContain('Switch over')
  expect(svg).toContain('Phase 1/3')
  expect(svg).toContain('Add the sessions table')
  expect(svg).not.toContain('Tokens leak')
  expect((await desk.find({ type: 'Svg' }))?.props.alt).toContain('0% done, 0 of 6 steps')
  await desk.unmount()
})

test('marking steps moves the tree on and estimates what is left', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  approve(on, PLAN)
  await $.tool.call({ tool: 'ExitPlanMode' } as never)

  await clock.advance(10 * 60_000)
  const marked = await $.tool.call({ tool: 'mcp__plan-progress__plan_mark', phase: 1, step: 1, status: 'done' } as never)
  // One step in ten minutes, five to go.
  expect(String(marked.result)).toContain('1/6 steps')
  expect(String(marked.result)).toContain('~50m left')
  expect(String(marked.result)).toContain('Current: 1.2 Write the session store')

  await clock.advance(10 * 60_000)
  await $.tool.call({ tool: 'mcp__plan-progress__plan_mark', phase: 1, status: 'done' } as never)

  const ui = await $.ui.mount({ plugin: 'plan-progress', surface: 'terminal', ...pane() })
  expect(await ui.find({ type: 'Text', text: ' 33%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 20m in' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: ' · ~40m left' }))?.props.color).toBe(LOOK.accent)
  expect((await ui.find({ type: 'Text', text: 'Replace token checks in the middleware' }))?.props.color).toBe(LOOK.text)
  await ui.unmount()

  const desk = await $.ui.mount({ plugin: 'plan-progress', surface: 'desktop', ...pane() })
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('>33%<')
  expect(svg).toContain('~40m left')
  expect(svg).toContain('2 steps done')
  await desk.unmount()

  const wrong = await $.tool.call({ tool: 'mcp__plan-progress__plan_mark', phase: 9, status: 'done' } as never)
  expect(wrong.deny).toContain('There is no phase 9')
})

test('todos named like a step tick it off', async ($, on) => {
  mock.clock(on, { now: 0 })
  approve(on, PLAN)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } as never }))
  await $.tool.call({ tool: 'ExitPlanMode' } as never)

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Add the sessions table', status: 'completed', activeForm: 'Adding' },
      { content: 'Write the session store', status: 'completed', activeForm: 'Writing' },
      { content: 'Update the login endpoint', status: 'in_progress', activeForm: 'Updating' },
    ],
  } as never)

  const ui = await $.ui.mount({ plugin: 'plan-progress', surface: 'terminal', ...pane() })
  expect((await ui.find({ type: 'Text', text: 'Update the login endpoint' }))?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: /2\/6 steps/ })).toBeDefined()
  await ui.unmount()
})

test('a plan without phase headings reads its nested list as phases', async ($, on) => {
  mock.clock(on, { now: 0 })
  approve(on, '1. **Backend**\n   - Add the endpoint\n   - Add the migration\n2. **Frontend**\n   - Build the form\n')
  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context?.[0]).toContain('1. Backend')
  expect(ran.context?.[0]).toContain('2.1 [ ] Build the form')
})

test('a rejected plan draws no tree, and plan_set draws one', async ($, on) => {
  mock.clock(on, { now: 0 })
  approve(on, PLAN, true)
  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context).toBeUndefined()

  const ui = await $.ui.mount({ plugin: 'plan-progress', surface: 'terminal', ...pane() })
  expect(await ui.find({ type: 'Text', text: 'No plan yet' })).toBeDefined()
  await ui.unmount()
  const desk = await $.ui.mount({ plugin: 'plan-progress', surface: 'desktop', ...pane() })
  expect(String((await desk.find({ type: 'Svg' }))?.props.source)).toContain('No plan yet')
  await desk.unmount()

  const set = await $.tool.call({
    tool: 'mcp__plan-progress__plan_set',
    title: 'Migrate the build',
    phases: [
      { title: 'Prepare', steps: ['Pin versions', 'Back up config'] },
      { title: 'Cut over', steps: ['Switch CI'] },
    ],
  } as never)
  expect(String(set.result)).toContain('2.1 [ ] Switch CI')
})

test('titles with markup characters are escaped in the image', async ($, on) => {
  mock.clock(on, { now: 0 })
  surface(on)
  await $.tool.call({ tool: 'mcp__plan-progress__plan_set', title: 'A <b> & "c"', phases: [{ title: 'x < y', steps: ['one', 'two'] }] } as never)
  const desk = await $.ui.mount({ plugin: 'plan-progress', surface: 'desktop', ...pane() })
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('A &lt;b&gt; &amp; &quot;c&quot;')
  expect(svg).toContain('x &lt; y')
  await desk.unmount()
})

test('a short pane folds the finished phases to one line', async ($, on) => {
  mock.clock(on, { now: 0 })
  approve(on, PLAN)
  await $.tool.call({ tool: 'ExitPlanMode' } as never)
  await $.tool.call({ tool: 'mcp__plan-progress__plan_mark', phase: 1, status: 'done' } as never)

  const ui = await $.ui.mount({ plugin: 'plan-progress', surface: 'terminal', ...pane(8) })
  expect(await ui.find({ type: 'Text', text: 'Add the sessions table' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /2\/2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Update the login endpoint' })).toBeDefined()
  await ui.unmount()
})
