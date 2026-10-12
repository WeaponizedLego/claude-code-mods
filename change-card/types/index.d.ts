export type Kind = 'new' | 'fix' | 'change' | 'removal' | 'chore'

export type Change = {
  kind: Kind
  title: string
  // One line each: how it behaved before, and after. Both optional.
  before?: string
  after?: string
  // Paths as git prints them; one ending in "/" covers everything under it.
  files: string[]
}

export type Spot = { file: string; line?: number; why: string }

export type Card = {
  title: string
  gist: string
  changes: Change[]
  look: Spot[]
  unchecked: string[]
  writtenAt: number
  // The diff the card was written against: path -> "+added -deleted".
  facts: Record<string, string>
}

// One repository the diff reads: the session's own, or each one in a folder of
// checkouts (a task folder holding one worktree per repo).
export type Repo = {
  // '' for the session's own repository; else the folder's name, which prefixes its paths.
  name: string
  dir: string
  // The commit compared against, and how it was found.
  base: string
  how: string
}

export type Facts = {
  repos: Repo[]
  // "58e1986 (fork point from origin/HEAD)", or one "<repo> <base>" per repository.
  since: string
  files: Record<string, string>
  added: number
  deleted: number
}

declare module 'claude-code' {
  interface PluginState {
    'change-card': {
      card: Card | null
      // The diff now, refreshed when a turn ends and when /changes runs.
      facts: Facts | null
      // A ref /changes was given, used in place of the fork point.
      baseRef: string | null
      // The diff a nudge was last shown for, so it is shown once.
      nudged: string | null
    }
  }
}
