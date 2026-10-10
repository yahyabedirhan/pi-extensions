// subagent-guard for Pi: the entry, and the only file that calls Pi. It
// closes the paths by which @tintinweb/pi-subagents can run a subagent's
// tools outside a `tool_call` guardrail. Rules live in policy.ts, disk
// reads in files.ts.

import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { agentTypeRisks, projectWarnings } from './files'
import { WORKFLOW_BLOCK, agentCallBlock, isProtectedPath, protectedNames } from './policy'

/** Names the extensions a subagent must keep, as a comma list. */
export const PROTECT_ENV = 'PI_SUBAGENT_GUARD_PROTECT'

const AGENT_TOOL = 'Agent'
const WORKFLOW_TOOL = 'SubagentWorkflow'
const FILE_TOOLS = new Set(['edit', 'write'])

interface GuardOptions {
  /** Pi's global agent dir. */
  agentDir: string
  /** The protected extension names, as a comma list. */
  protect: string | undefined
}

export function createSubagentGuard(options: GuardOptions): (pi: ExtensionAPI) => void {
  const names = protectedNames(options.protect)

  function guardAgent(input: Record<string, unknown>, ctx: ExtensionContext): ToolCallEventResult | undefined {
    const reason = agentCallBlock(input)
    if (reason) {
      return { block: true, reason }
    }
    if (typeof input.subagent_type !== 'string' || input.resume) {
      return undefined
    }
    const found = agentTypeRisks(ctx.cwd, options.agentDir, input.subagent_type, names)

    return found
      ? {
          block: true,
          reason: `subagent-guard: agent type "${input.subagent_type}" comes from ${found.path}, which sets ${found.risks.join('; ')}, so its tools would run outside the tool_call guardrail. Pick another agent type, or ask the user to change that file.`,
        }
      : undefined
  }

  async function guardFile(path: string, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    if (!isProtectedPath(path, ctx.cwd, options.agentDir)) {
      return undefined
    }
    const what = `${path} configures pi-subagents (agents, workflows or settings), and a change there can let subagents run outside the tool_call guardrail.`
    if (!ctx.hasUI) {
      return { block: true, reason: `subagent-guard: ${what} No user is here to approve it, so the change is blocked.` }
    }
    const answer = await ctx.ui.select(`subagent-guard: allow this change? ${what}`, ['No', 'Yes'])

    return answer === 'Yes' ? undefined : { block: true, reason: `subagent-guard: the user declined the change to ${path}.` }
  }

  return function subagentGuard(pi: ExtensionAPI): void {
    pi.on('tool_call', async (event, ctx) => {
      const input = event.input as Record<string, unknown>
      if (event.toolName === AGENT_TOOL) {
        return guardAgent(input, ctx)
      }
      if (event.toolName === WORKFLOW_TOOL) {
        return { block: true, reason: WORKFLOW_BLOCK }
      }
      if (FILE_TOOLS.has(event.toolName) && typeof input.path === 'string') {
        return guardFile(input.path, ctx)
      }

      return undefined
    })

    pi.on('session_start', (_event, ctx) => {
      if (!ctx.hasUI) {
        return
      }
      const warnings = projectWarnings(ctx.cwd, names)
      if (warnings.length > 0) {
        ctx.ui.notify(
          `subagent-guard: these project files let subagents run outside the tool_call guardrail:\n${warnings.map(line => `- ${line}`).join('\n')}`,
          'warning',
        )
      }
    })
  }
}

export default function subagentGuard(pi: ExtensionAPI): void {
  createSubagentGuard({ agentDir: getAgentDir(), protect: process.env[PROTECT_ENV] })(pi)
}
