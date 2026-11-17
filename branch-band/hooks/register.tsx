import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GitInfo, Worktree } from '../types'

const info = atom({ plugin: 'branch-band', key: 'info' } as const, null)

const POLL_MS = 15_000

// The mods' shared slate look, as text colours: periwinkle mark, ivory branch, muted rest.
const C = { mark: '#8b90d6', text: '#e8eaf0', muted: '#9aa1b5' } as const

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/** Parses `git worktree list --porcelain`, marking the one at `currentTop`. */
export function parseWorktrees(porcelain: string, currentTop: string): Worktree[] {
  return porcelain
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n')
      const path = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
      const ref = lines.find(l => l.startsWith('branch '))?.slice('branch '.length)
      const branch = ref
        ? ref.replace(/^refs\/heads\//, '')
        : lines.includes('bare')
          ? ''
          : 'detached'
      return { path, branch, isCurrent: path === currentTop }
    })
    .filter(w => w.branch !== '')
}

/** The band's text: the current branch, then the other worktrees by folder and branch. */
export function describe(g: GitInfo): { branch: string; others: string } {
  const others = g.worktrees.filter(w => !w.isCurrent)
  if (others.length === 0) return { branch: g.branch, others: '' }
  const list = others.map(w => `${baseName(w.path)} [${w.branch}]`).join(', ')
  return { branch: g.branch, others: `  ·  ${others.length} other worktree${others.length === 1 ? '' : 's'}: ${list}` }
}

/** Reads the branch and worktrees for the session's directory into the atom. */
async function refresh($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const opts = { cwd, timeoutMs: 5000 }

    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], opts)
    if (top.exitCode !== 0) {
      await update($, info, () => null)
      return
    }
    const [head, list] = await Promise.all([
      $.process.run(['git', 'branch', '--show-current'], opts),
      $.process.run(['git', 'worktree', 'list', '--porcelain'], opts),
    ])
    let branch = head.stdout.trim()
    if (!branch) {
      const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], opts)
      branch = `detached @ ${sha.stdout.trim()}`
    }
    const fresh: GitInfo = { branch, worktrees: parseWorktrees(list.stdout, top.stdout.trim()) }
    await update($, info, prev => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh))
  } catch {
    // git missing or timed out: keep the last good value rather than flicker.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // Catches branch switches made outside this session (another terminal, an IDE).
    $.clock.every(POLL_MS, () => void refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await refresh($)
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Draw whatever sits beneath (usage-band) first, then this row under it.
    const beneath = await next(e)
    const g = await read($, info)
    if (e.props.hasSurvey || !g) return beneath

    const { Box, Text } = $.ui.resolve(e)
    const { branch, others } = describe(g)
    const row = (
      <Box flexDirection="row" key="branch-band">
        <Text color={C.mark}>⎇ </Text>
        <Text color={C.text} bold>
          {branch}
        </Text>
        <Text color={C.muted} wrap="truncate-end">
          {others}
        </Text>
      </Box>
    )
    return beneath ? (
      <Box flexDirection="column">
        {beneath}
        {row}
      </Box>
    ) : (
      row
    )
  })
}
