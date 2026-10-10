// session-status for Pi: the entry, and the only file that calls Pi. It
// wires Pi's events to the copied core (core/) and the adapter modules
// beside it. Keep feature logic in those modules; keep only I/O here.

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { hyperlink, truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import { afterTurn, settlesByPrompt } from './core/hooks/activity'
import { EFFORT_SKILLS, effortSighting } from './core/hooks/effort'
import { INSTRUCTIONS } from './core/hooks/instructions'
import { STATUS_TOOL_SPEC } from './core/hooks/status-tool'
import { toolResultChange } from './core/hooks/tool-results'
import { GitHubReads } from './github'
import { StatusOverlayModel, keyName, overlayLines } from './overlay'
import { applyChoice } from './replies'
import type { Choice } from './replies'
import { ENTRY_TYPE, StatusStore, restoreStatus } from './state'
import type { EntryLike } from './state'
import { TOOL_DESCRIPTION, TOOL_NAME, forPi, reset, runStatusCall } from './tool'
import type { StatusEffects } from './tool'
import { OVERLAY_HINT, bandText, widgetLines } from './view'
import type { Paint } from './view'

const COMMAND = 'session-status'
const WIDGET_KEY = 'session-status'
/** The system prompt section's key: Pi wraps it in a tag of this name. */
const SECTION_KEY = 'session_status'
const SHORTCUT = OVERLAY_HINT

/** The mod's instructions with Pi's names, plus where the answers come from in Pi. */
export const INSTRUCTIONS_TEXT = `${forPi(INSTRUCTIONS.text)}
- In Pi, the status shows in a widget above the editor, and the user answers in an overlay (${SHORTCUT} or \`/${COMMAND}\`). Its answers arrive as the same prompts as the pane's buttons.`

/** The skills a `read` of their SKILL.md runs: Pi loads a skill by reading its file. */
const SETTLE_SKILL_FILE = /(?:^|\/)(?:settle-session|settle-effort)\/SKILL\.md$/
const EFFORT_SKILL_FILE = new RegExp(`(?:^|/)(?:${EFFORT_SKILLS.join('|')})/SKILL\\.md$`)

export default function sessionStatus(pi: ExtensionAPI): void {
  let store: StatusStore | null = null
  let ui: ExtensionContext['ui'] | null = null
  let hasUi = false
  let isWidgetHidden = false
  let isOverlayOpen = false

  const reads = new GitHubReads(
    () => store,
    async (argv, timeoutMs) => {
      const [command = '', ...args] = argv
      const result = await pi.exec(command, args, { timeout: timeoutMs })

      return { code: result.code, stdout: result.stdout }
    },
  )

  const effects: StatusEffects = {
    // A ping is a courtesy: without shipyard, or on a failure, the call goes on without it.
    ping: argv => {
      const [command = '', ...args] = argv
      void pi.exec(command, args, { timeout: 10_000 }).catch(() => undefined)
    },
    linked: () => reads.readLinkStatesIfDue({ tool: TOOL_NAME }),
    ticketReported: () => {
      reads.effortSeen(null)
      reads.countTicketsIfDue({ tool: TOOL_NAME })
    },
  }

  /** Makes `store` hold the status of the session `ctx` runs: restored from its branch. */
  function holdSession(ctx: ExtensionContext): StatusStore {
    ui = ctx.ui
    hasUi = ctx.hasUI
    const sessionId = ctx.sessionManager.getSessionId()
    if (store?.sessionId === sessionId) {
      return store
    }
    const restored = restoreStatus(ctx.sessionManager.getBranch() as EntryLike[], sessionId)
    const next = new StatusStore(sessionId, restored, status => pi.appendEntry(ENTRY_TYPE, status))
    next.onChange(() => draw())
    store = next
    // A restored turn is over: a status saved mid-turn reads as waiting, or settled.
    if (restored?.activity === 'working' || restored?.activity === 'settling') {
      next.change(status => ({ ...status, activity: afterTurn(status.activity, false) }), { save: false })
    }
    draw()

    return next
  }

  function paintFor(theme: { fg(color: never, text: string): string; bold(text: string): string }): Paint {
    return {
      fg: (tone, text) => (theme.fg as (color: string, text: string) => string)(tone, text),
      bold: text => theme.bold(text),
      link: (text, url) => hyperlink(text, url),
    }
  }

  /** Draws the widget and the footer band again, or clears them when there is nothing to show. */
  function draw(): void {
    if (ui === null || !hasUi || store === null) {
      return
    }
    const current = store
    const hasStatus = current.hasStatus() && widgetLines(current.get()).length > 0
    ui.setStatus(WIDGET_KEY, current.hasStatus() ? bandText(current.get()) : undefined)
    if (!hasStatus || isWidgetHidden) {
      ui.setWidget(WIDGET_KEY, undefined)

      return
    }
    ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      render: (width: number) => widgetLines(current.get(), paintFor(theme)).map(line => truncateToWidth(line, width)),
      invalidate: () => undefined,
    }))
  }

  /** Sends a prompt in the person's own words: now when idle, else after the running turn. */
  function send(prompt: string, ctx: ExtensionContext): void {
    if (ctx.isIdle()) {
      pi.sendUserMessage(prompt)
    } else {
      pi.sendUserMessage(prompt, { deliverAs: 'followUp' })
    }
  }

  async function openOverlay(ctx: ExtensionContext): Promise<void> {
    const current = holdSession(ctx)
    if (ctx.mode !== 'tui') {
      ctx.ui.notify(bandText(current.get()), 'info')

      return
    }
    if (isOverlayOpen) {
      return
    }
    isOverlayOpen = true
    let choice: Choice | undefined
    try {
      choice = await ctx.ui.custom<Choice | undefined>(
        (tui, theme, _keybindings, done) => {
          const model = new StatusOverlayModel(() => current.get(), done)

          return {
            render: (width: number) => overlayLines(model, paintFor(theme), width),
            handleInput: (data: string) => {
              const key = keyName(data)
              if (key !== null) {
                model.press(key)
                tui.requestRender()
              }
            },
            invalidate: () => undefined,
          }
        },
        { overlay: true, overlayOptions: { width: '70%', minWidth: 50, maxHeight: '80%', anchor: 'center' } },
      )
    } finally {
      isOverlayOpen = false
    }
    if (choice === undefined) {
      return
    }
    const prompt = applyChoice(current, choice, Date.now(), effects)
    if (prompt !== null) {
      send(prompt, ctx)
    }
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Session status',
    description: TOOL_DESCRIPTION,
    // The mod's JSON Schema as it is: TypeBox takes a plain JSON Schema through Unsafe.
    parameters: Type.Unsafe<Record<string, unknown>>(STATUS_TOOL_SPEC.inputSchema as unknown as Record<string, unknown>),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const reply = runStatusCall(holdSession(ctx), params as Record<string, unknown>, Date.now(), effects)
      if (reply.isError) {
        throw new Error(reply.text)
      }

      return { content: [{ type: 'text', text: reply.text }], details: undefined }
    },
  })

  pi.registerCommand(COMMAND, {
    description: 'Answer the session status; `hide` or `show` the widget; `reset` clears the whole session status',
    getArgumentCompletions: prefix =>
      ['hide', 'show', 'reset'].filter(arg => arg.startsWith(prefix)).map(arg => ({ value: arg, label: arg })),
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase()
      const current = holdSession(ctx)
      if (arg === 'reset') {
        ctx.ui.notify(reset(current), 'info')
      } else if (arg === 'hide' || arg === 'show') {
        isWidgetHidden = arg === 'hide'
        draw()
      } else if (arg === '') {
        await openOverlay(ctx)
      } else {
        ctx.ui.notify(`Unknown argument "${args.trim()}". Use /${COMMAND}, /${COMMAND} hide, show or reset.`, 'warning')
      }
    },
  })

  pi.registerShortcut(SHORTCUT, {
    description: 'Answer the session status',
    handler: ctx => openOverlay(ctx),
  })

  // A start, a resume, a reload, a new session or a fork: the status follows
  // the session id (see restoreStatus), so a new session or a fork starts empty.
  pi.on('session_start', (_event, ctx) => {
    store = null
    holdSession(ctx)
  })

  // A move in /tree: the status is the one the new branch saved.
  pi.on('session_tree', (_event, ctx) => {
    store = null
    holdSession(ctx)
  })

  pi.on('before_agent_start', (event, ctx) => {
    holdSession(ctx)
    event.systemPromptOptions.sections[SECTION_KEY] = INSTRUCTIONS_TEXT
  })

  // A prompt that types a settle skill's command settles the turn.
  pi.on('input', (event, ctx) => {
    if (settlesByPrompt(event.text)) {
      holdSession(ctx).change(status => ({ ...status, activity: 'settling' }), { save: false })
    }
  })

  pi.on('agent_start', (_event, ctx) => {
    holdSession(ctx).change(status => (status.activity === 'settling' ? status : { ...status, activity: 'working' }), { save: false })
  })

  pi.on('agent_end', (event, ctx) => {
    const last = event.messages.at(-1) as { stopReason?: string } | undefined
    holdSession(ctx).change(status => ({ ...status, activity: afterTurn(status.activity, last?.stopReason === 'aborted') }))
  })

  pi.on('tool_result', (event, ctx) => {
    const current = holdSession(ctx)
    if (event.toolName === 'read') {
      const path = String(event.input.path ?? '')
      if (SETTLE_SKILL_FILE.test(path)) {
        current.change(status => ({ ...status, activity: 'settling' }), { save: false })
      }
      if (EFFORT_SKILL_FILE.test(path)) {
        reads.effortSeen(null)
      }

      return
    }
    if (event.toolName !== 'bash') {
      return
    }
    const command = String(event.input.command ?? '')
    const call = { tool: 'Bash', command }
    const sighting = effortSighting(call)
    if (sighting !== null) {
      reads.effortSeen(sighting.name)
    }
    const output = event.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
    const change = toolResultChange(call, event.isError ? { isError: true } : { text: output }, Date.now())
    if (change !== null) {
      current.change(change)
    }
    reads.afterCall(call)
  })
}
