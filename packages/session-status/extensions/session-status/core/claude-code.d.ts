// The few Claude Code types the copied core modules import. They are type
// imports only, so nothing here exists at run time: jiti and vitest drop them.

declare module 'claude-code' {
  /** A system prompt section (instructions.ts). */
  export type PromptComposeSection = { id: string; text: string; scope: 'session' | 'global' }

  /** A tool call as tool-results.ts reads it: the tool's name, its input fields and the subagent's id. */
  export type ToolCallInput = { tool: string; agentId?: string } & Record<string, unknown>

  /** A tool call's answer as tool-results.ts reads it. */
  export type ToolCallResult = { deny?: string; isError?: boolean; result?: unknown; text?: string }

  /** The mod's state slots, which types/index.d.ts augments. */
  export interface PluginState {}
}

declare module 'claude-code/testing' {
  export { expect, test } from 'vitest'
}
