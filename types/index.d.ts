export type LimitItem = { name: string; percent: number; reset: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': { items: LimitItem[] }
  }
}
