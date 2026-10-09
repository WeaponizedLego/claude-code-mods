export type TaskStatus = 'pending' | 'active' | 'passed' | 'failed' | 'skipped'

export type Task = { title: string; status: TaskStatus; note?: string; startedAt?: number; endedAt?: number }

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
