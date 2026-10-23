// implementing: a worktree with no PR yet. pr: an open PR with nothing to answer.
// feedback: an open PR with unresolved review threads. merged and closed: the PR
// ended; the worktree waits for task-close.
export type Stage = 'implementing' | 'pr' | 'feedback' | 'merged' | 'closed'

export type Pr = {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  title: string
  checksPassed: number
  checksFailed: number
  checksTotal: number
  // Review threads not yet resolved; 0 when the PR is not open.
  unresolved: number
  mergedAt?: string
}

export type Task = {
  // Absolute path of the worktree under <hub>/work/<repo>/<KEY>-<slug>.
  path: string
  repo: string
  key: string
  slug: string
  // From the plan file's first heading, else the PR title, else the slug.
  title: string
  branch: string
  base: string
  hasPlan: boolean
  // Commits on the branch that the base does not have.
  ahead: number
  isDirty: boolean
  pr?: Pr
}

export type Setup = {
  hasLocalRepos: boolean
  // null when gh could not say (not installed, not signed in).
  hasPackagesScope: boolean | null
}

export type Board = {
  hub: string
  tasks: Task[]
  setup: Setup
  syncedAt: number
}

export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed'

export type Validation = {
  repo: string
  checks: { command: string; status: CheckStatus }[]
}

export type Mode = 'unattended' | 'interactive'

declare module 'claude-code' {
  interface PluginState {
    'control-tower': {
      // null outside a hub: the mod then stays out of the way.
      board: Board | null
      isSyncing: boolean
      validation: Validation | null
      mode: Mode
      // The worktree most recently touched by a tool call.
      active: string | null
      // Tool calls the guards refused this session.
      blocked: number
      // Bumped by the ticker so "synced 2m ago" redraws.
      now: number
      // What is typed in the pane's ticket field; read when Start is pressed.
      draft: string
    }
  }
}
