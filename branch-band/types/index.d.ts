export type Worktree = { path: string; branch: string; isCurrent: boolean }
export type GitInfo = { branch: string; worktrees: Worktree[] }

declare module 'claude-code' {
  interface PluginState {
    'branch-band': { info: GitInfo | null }
  }
}
