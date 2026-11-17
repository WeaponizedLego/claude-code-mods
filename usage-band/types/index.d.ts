export type Limit = { kind: string; percentUsed: number }

export type Snapshot = {
  contextTokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  limits: Limit[]
}

export type Tokens = { input: number; output: number; cacheRead: number }

export type Worktree = { path: string; branch: string; isCurrent: boolean }
/** The session's checkout: its branch and every worktree of its repository. Null outside a repository. */
export type Git = { branch: string; worktrees: Worktree[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; tokens: Tokens; git: Git | null }
  }
}
