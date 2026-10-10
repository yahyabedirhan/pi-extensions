// session-status for Pi: the entry, and the only file that calls Pi. It
// wires Pi's events to the copied core (core/) and the adapter modules
// beside it. Keep feature logic in those modules; keep only I/O here.

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { type OverlayHandle, hyperlink } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import { afterTurn, settlesByPrompt } from './core/hooks/activity'
import { EFFORT_SKILLS, effortSighting } from './core/hooks/effort'
import { INSTRUCTIONS } from './core/hooks/instructions'
import { STATUS_TOOL_SPEC } from './core/hooks/status-tool'
import { toolResultChange } from './core/hooks/tool-results'
import { GitHubReads } from './github'
import { MIN_SIDEBAR_WIDTH, StatusOverlayModel, keyName, overlayLines, resizeSidebarWidth, sidebarWidth } from './overlay'
import { applyChoice } from './replies'
import type { SidebarMetadata } from './sidebar'
import { ENTRY_TYPE, StatusStore, restoreStatus } from './state'
import type { EntryLike } from './state'
import { TOOL_DESCRIPTION, TOOL_NAME, forPi, reset, runStatusCall } from './tool'
import type { StatusEffects } from './tool'
import { OVERLAY_HINT, bandText, widgetFrame, widgetLines } from './view'
import type { Paint } from './view'

const COMMAND = 'session-status'
const WIDGET_KEY = 'session-status'
/** The system prompt section's key: Pi wraps it in a tag of this name. */
const SECTION_KEY = 'session_status'
const SHORTCUT = OVERLAY_HINT

/** The mod's instructions with Pi's names, plus where the answers come from in Pi. */
export const INSTRUCTIONS_TEXT = `${forPi(INSTRUCTIONS.text)}
- In Pi, the status shows in a persistent right sidebar when enabled, or a widget above the editor. Use ${SHORTCUT} to focus the sidebar and \`/${COMMAND}\` to toggle it. Answers arrive as the same prompts as the pane's buttons.`

/** The skills a `read` of their SKILL.md runs: Pi loads a skill by reading its file. */
const SETTLE_SKILL_FILE = /(?:^|\/)(?:settle-session|settle-effort)\/SKILL\.md$/
const EFFORT_SKILL_FILE = new RegExp(`(?:^|/)(?:${EFFORT_SKILLS.join('|')})/SKILL\\.md$`)

export default function sessionStatus(pi: ExtensionAPI): void {
  let store: StatusStore | null = null
  let ui: ExtensionContext['ui'] | null = null
  let hasUi = false
  let isWidgetHidden = false
  type Panel = { handle?: OverlayHandle; owner: ExtensionContext['ui']; render?: () => void; ageTimer?: ReturnType<typeof setInterval>; visible: boolean; focus: boolean }
  let panel: Panel | null = null
  let panelWidth: number | undefined
  let sidebarMetadata: SidebarMetadata = {}

  function closePanel(): void {
    const previous = panel
    panel = null
    if (previous?.ageTimer !== undefined) clearInterval(previous.ageTimer)
    previous?.handle?.hide()
    previous?.owner.setWidget('session-status-sidebar-host', undefined)
    draw()
  }

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
    closePanel()
    const restored = restoreStatus(ctx.sessionManager.getBranch() as EntryLike[], sessionId)
    const next = new StatusStore(sessionId, restored, status => pi.appendEntry(ENTRY_TYPE, status))
    next.onChange(() => draw())
    store = next
    sidebarMetadata = typeof ctx.cwd === 'string' ? { cwd: ctx.cwd } : {}
    if (sidebarMetadata.cwd !== undefined) {
      // Location is presentation metadata, not a mutation of the shared status contract.
      void pi.exec('git', ['-C', sidebarMetadata.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5_000 })
        .then(result => {
          if (store !== next || result.code !== 0) return
          sidebarMetadata = { ...sidebarMetadata, branch: result.stdout.trim() || undefined }
          draw()
        }).catch(() => undefined)
    }
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
    panel?.render?.()
    if (!hasStatus || isWidgetHidden || panel?.visible) {
      ui.setWidget(WIDGET_KEY, undefined)

      return
    }
    ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      render: (width: number) => {
        const paint = paintFor(theme)
        return widgetFrame(widgetLines(current.get(), paint), width, paint)
      },
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

  function showPanel(ctx: ExtensionContext, focus = false): void {
    const current = holdSession(ctx)
    if (ctx.mode !== 'tui') {
      ctx.ui.notify(bandText(current.get()), 'info')
      return
    }
    if (panel !== null) {
      panel.visible = true
      panel.handle?.setHidden(false)
      if (focus) {
        if (panel.handle?.isFocused()) panel.handle.unfocus()
        else panel.handle?.focus()
      }
      draw()
      return
    }
    const instance: Panel = { visible: true, focus, owner: ctx.ui }
    panel = instance
    ctx.ui.setWidget('session-status-sidebar-host', (tui, theme) => {
      const host = {
        render: () => [] as string[], invalidate: () => undefined,
        dispose: () => {
          if (instance.ageTimer !== undefined) clearInterval(instance.ageTimer)
          instance.handle?.hide()
        },
      }
      if (panel !== instance || instance.handle !== undefined) return host
      instance.render = () => tui.requestRender()
      const release = () => instance.handle?.unfocus()
      const model = new StatusOverlayModel(() => current.get(), choice => {
        if (panel !== instance) return
        if (choice === undefined) { release(); return }
        const prompt = applyChoice(current, choice, Date.now(), effects)
        if (prompt !== null) send(prompt, ctx)
      }, () => sidebarMetadata)
      const component = {
        render: (width: number) => overlayLines(model, paintFor(theme), width, tui.terminal.rows, instance.handle?.isFocused()),
        handleInput: (data: string) => {
          const key = keyName(data)
          if (key === 'tab' || key === 'focus') release()
          else if (key === '<' || key === '>') {
            panelWidth = resizeSidebarWidth(panelWidth, tui.terminal.columns, key === '<' ? -1 : 1)
          } else if (key !== null) model.press(key)
          tui.requestRender()
        },
        invalidate: () => undefined,
      }
      instance.handle = tui.showOverlay(component, {
        get width(): number { return sidebarWidth(panelWidth) },
        minWidth: MIN_SIDEBAR_WIDTH, maxHeight: '100%', anchor: 'top-right', margin: 0, nonCapturing: true,
      })
      instance.ageTimer = setInterval(() => {
        if (panel === instance && instance.visible) tui.requestRender()
      }, 15_000)
      instance.ageTimer.unref()
      instance.handle.setHidden(!instance.visible)
      if (instance.focus) instance.handle.focus()
      return host
    })
    draw()
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
    description: 'Toggle the sidebar; sidebar show/hide/focus/width N; widget show/hide; reset status',
    getArgumentCompletions: prefix =>
      ['sidebar show', 'sidebar hide', 'sidebar focus', 'sidebar width ', 'widget show', 'widget hide', 'reset'].filter(arg => arg.startsWith(prefix)).map(arg => ({ value: arg, label: arg })),
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase()
      const current = holdSession(ctx)
      if (arg === 'reset') {
        ctx.ui.notify(reset(current), 'info')
      } else if (arg === 'widget hide' || arg === 'widget show') {
        isWidgetHidden = arg === 'widget hide'
        draw()
      } else if (arg === 'sidebar hide' || (arg === '' && panel?.visible)) {
        if (panel !== null) {
          panel.visible = false
          panel.handle?.unfocus()
          panel.handle?.setHidden(true)
          draw()
        }
      } else if (arg === '' || arg === 'sidebar show' || arg === 'sidebar focus') {
        showPanel(ctx, arg === 'sidebar focus')
      } else if (/^sidebar width [1-9]\d*$/.test(arg) && Number(arg.slice(14)) >= MIN_SIDEBAR_WIDTH) {
        panelWidth = Number(arg.slice(14))
        panel?.render?.()
      } else {
        ctx.ui.notify(`Use /${COMMAND} [sidebar show|sidebar hide|sidebar focus|sidebar width N|widget show|widget hide|reset]; width must be at least 12 columns.`, 'warning')
      }
    },
  })

  pi.registerShortcut(SHORTCUT, {
    description: 'Answer the session status',
    handler: ctx => showPanel(ctx, true),
  })

  // A start, a resume, a reload, a new session or a fork: the status follows
  // the session id (see restoreStatus), so a new session or a fork starts empty.
  pi.on('session_start', (_event, ctx) => {
    closePanel()
    store = null
    holdSession(ctx)
  })

  // A move in /tree: the status is the one the new branch saved.
  pi.on('session_tree', (_event, ctx) => {
    closePanel()
    store = null
    holdSession(ctx)
  })

  pi.on('session_shutdown', () => closePanel())

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

  pi.on('tool_execution_start', (event, ctx) => {
    holdSession(ctx)
    const args = event.args ?? {}
    const text = String(args.description ?? args.path ?? args.command ?? event.toolName).replace(/\s+/g, ' ').slice(0, 160)
    sidebarMetadata = { ...sidebarMetadata, now: { tool: event.toolName, text } }
    panel?.render?.()
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
