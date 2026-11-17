import type { Git, Worktree } from '../types'

export const folderName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/** Parses `git worktree list --porcelain`, marking the one at `currentTop`; bare entries are left out. */
export function parseWorktrees(porcelain: string, currentTop: string): Worktree[] {
  return porcelain
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n')
      const path = lines.find(l => l.startsWith('worktree '))?.slice('worktree '.length) ?? ''
      const ref = lines.find(l => l.startsWith('branch '))?.slice('branch '.length)
      const branch = ref ? ref.replace(/^refs\/heads\//, '') : lines.includes('bare') ? '' : 'detached'
      return { path, branch, isCurrent: path === currentTop }
    })
    .filter(w => w.branch !== '')
}

/** The other worktrees, as a count and their folder names. */
export function others(git: Git): { count: number; names: string } {
  const rest = git.worktrees.filter(w => !w.isCurrent)
  return { count: rest.length, names: rest.map(w => folderName(w.path)).join(', ') }
}
