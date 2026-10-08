export type Limit = { kind: string; percentUsed: number }

export type Snapshot = {
  contextTokens: number | null
  window: number
  percent: number | null
  costUsd: number | null
  limits: Limit[]
}

export type Tokens = { input: number; output: number; cacheRead: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; tokens: Tokens }
  }
}
