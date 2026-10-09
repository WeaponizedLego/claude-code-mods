export type TaskStatus = 'pending' | 'active' | 'passed' | 'failed' | 'skipped'

export type Task = {
  title: string
  status: TaskStatus
  note?: string
  startedAt?: number
  endedAt?: number
  // Skipped only because the run ended with it open; a reopened run takes it up again.
  isAutoSkipped?: true
}

export type Severity = 'blocker' | 'major' | 'minor' | 'polish'

export type Finding = {
  severity: Severity
  title: string
  detail?: string
  // The screen or URL it was seen on.
  where?: string
  // The task it came up in, from 0.
  task?: number
  at: number
}

// running: still going. passed: every task passed, nothing found. issues: done,
// with failed tasks or findings. blocked: the tester could not test (app not
// reachable, no way in). failed: the run itself died (error, interrupt).
export type RunStatus = 'running' | 'passed' | 'issues' | 'blocked' | 'failed'

export type Run = {
  // The tester's agent id, or 'main' when Claude records a run itself.
  agentId: string
  tester: string
  brief: string
  target?: string
  scope?: 'feature' | 'app'
  status: RunStatus
  startedAt: number
  endedAt?: number
  tasks: Task[]
  findings: Finding[]
  summary?: string
  // Why the run was blocked or failed.
  failure?: string
  // The Agent call that started it, so its result can carry the report.
  toolUseId?: string
  // Who ended it: the tester through test_finish, or its turn ending without one.
  endedBy?: 'tester' | 'turn'
  // Whether the main conversation has been handed the finished report.
  isDelivered?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'test-user': {
      // Newest first; the pane shows the first.
      runs: Run[]
      // Bumped by the ticker so elapsed times redraw while a run goes.
      now: number
    }
  }
}
