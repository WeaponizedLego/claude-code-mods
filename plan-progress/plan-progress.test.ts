import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'plan-progress', surface, ...pane() })
    expect(await ui.find({ type: 'Text', text: 'Move auth to sessions' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 Switch over' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Context' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'Add the sessions table' }))?.props.color).toBe('claude')
    expect((await ui.find({ type: 'Text', text: 'Run the auth test suite' }))?.props.color).toBe('inactive')
    await ui.unmount()
  }
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
  expect(await ui.find({ type: 'Text', text: /20m in · ~40m left/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'Replace token checks in the middleware' }))?.props.color).toBe('claude')
  await ui.unmount()

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

  const ui = await $.ui.mount({ plugin: 'plan-progress', surface: 'desktop', ...pane() })
  expect((await ui.find({ type: 'Text', text: 'Write the session store' }))?.props.color).toBe('text')
  expect((await ui.find({ type: 'Text', text: 'Update the login endpoint' }))?.props.color).toBe('claude')
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
  expect(await ui.find({ type: 'Text', text: 'No plan yet.' })).toBeDefined()
  await ui.unmount()

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
