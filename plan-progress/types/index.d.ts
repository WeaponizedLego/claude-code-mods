export type StepStatus = 'pending' | 'active' | 'done' | 'skipped'

export type Step = { title: string; status: StepStatus; startedAt?: number; endedAt?: number }

export type Phase = { title: string; steps: Step[] }

export type Plan = {
  title: string
  // Where the tree came from: an approved plan-mode plan, or the model's plan_set.
  source: 'plan-mode' | 'model'
  createdAt: number
  phases: Phase[]
}

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      plan: Plan | null
      // Bumped by the ticker so elapsed times redraw while a plan runs.
      now: number
      // Task ids to subjects, so a TaskUpdate can be matched to a step.
      tasks: Record<string, string>
    }
  }
}
