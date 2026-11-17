import { expect, test } from 'claude-code/testing'

import { describe as describeBand, parseWorktrees } from './hooks/register'

const BAND = {
  plugin: 'branch-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
} as const

const PORCELAIN = `worktree /Users/me/repo
HEAD 1111111
branch refs/heads/main

worktree /Users/me/repo-wt/PLAT-1
HEAD 2222222
branch refs/heads/feature/PLAT-1

worktree /Users/me/repo-wt/scratch
HEAD 3333333
detached
`

test('worktrees parse, the current one marked', async () => {
  const wts = parseWorktrees(PORCELAIN, '/Users/me/repo-wt/PLAT-1')
  expect(wts.map(w => [w.branch, w.isCurrent])).toEqual([
    ['main', false],
    ['feature/PLAT-1', true],
    ['detached', false],
  ])
  expect(describeBand({ branch: 'feature/PLAT-1', worktrees: wts }).others).toBe(
    '  ·  2 other worktrees: repo [main], scratch [detached]',
  )
})

test('the row draws under the band beneath it', async ($, on) => {
  on('state.get', () => ({
    value: {
      value: { branch: 'feature/PLAT-1', worktrees: parseWorktrees(PORCELAIN, '/Users/me/repo-wt/PLAT-1') },
      version: 1,
    },
  }))
  // Stands for usage-band (or the engine) beneath this mod.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /usage/ }))?.text).toBe('usage')
    expect((await ui.find({ type: 'Text', text: /PLAT-1/ }))?.text).toBe('feature/PLAT-1')
    expect((await ui.find({ type: 'Text', text: /other worktrees/ }))).toBeDefined()
    await ui.unmount()
  }
})

test('outside a git repo the band shows nothing of its own', async ($, on) => {
  on('state.get', () => ({ value: { value: null, version: 1 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /⎇/ }))).toBeUndefined()
  await ui.unmount()
})
