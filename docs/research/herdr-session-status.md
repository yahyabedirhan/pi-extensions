# Herdr-hosted Pi Session Status

## Finding

Herdr can give Pi Session Status a real right-hand column through a **terminal split**, not through a custom native sidebar. This is feasible with supported APIs, but requires a separate terminal renderer and a bridge to the Pi extension. It is not a setting for the current overlay.

Research checked Herdr 0.9.3 documentation and API types at commit `7b116c05bfda646af39d2524c54e70c751f57ee8`. No plugin prototype or layout change was performed.

## Verified capabilities

- Plugins launch manifest-declared external executables. Native non-terminal plugin UI is explicitly outside the plugin contract. [Plugin contract](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/plugins.mdx)
- `plugin.pane.open` accepts `placement: "split"`, `direction: "right"`, an explicit `target_pane_id`, injected environment and `focus: false`. A split gives Pi a smaller PTY; its conversation and editor wrap to that width. [Request types](https://github.com/herdrdev/herdr/blob/7b116c05bfda646af39d2524c54e70c751f57ee8/src/api/schema/plugins.rs)
- `agent.view.set` filters and sorts the existing Agents sidebar. It is not an arbitrary custom status renderer. [Socket API](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/socket-api.mdx)
- Pane resize and layout APIs support sizing and topology subscriptions. Plugin-open width and height are documented for popups, not fixed-column splits. A 64-column split needs layout-aware sizing logic. [Socket API](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/socket-api.mdx)
- `agent.prompt` can submit terminal input to a recognized agent, but it does not apply Session Status state transitions and rejects blocked agents. It is insufficient as the choice transport by itself. [Socket API](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/socket-api.mdx)
- Cold server restart restores layout, not arbitrary panel processes. A plugin bridge must reconcile or restart its own renderer. [Session restore](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/session-state.mdx)

## Proposed integration, not implemented

```text
Herdr tab
├── Pi terminal                 # normal conversation and editor, genuinely narrower
│   └── Session Status adapter  # authoritative StatusStore and applyChoice
│          ↕ local IPC
└── status renderer terminal    # owned right-hand split, not an overlay
```

1. Keep `StatusStore`, custom-entry persistence and `applyChoice` inside Pi.
2. Let an explicitly enabled Herdr adapter open one owned panel for the original Pi pane and session.
3. Send snapshots and choices through local IPC with session, process-generation and revision identifiers.
4. Apply choices in Pi before using its existing idle submission or busy-turn `followUp` delivery.
5. Rebind on session changes and `/tree`; close only the owned panel on shutdown.
6. Reconcile pane moves, replaced agents, abrupt exits and server reconnects.
7. Retain the existing widget and overlay when Herdr is unavailable.

Opening or closing a Session Status panel must not globally enable or disable a Herdr plugin. A split remains a user-resizable, movable terminal pane, not a protected dock.

On remote machines, Pi, its bridge and its renderer should run on the same owning Herdr server. IDs are server-scoped; local files are not a remote transport. Plugin installation must be managed separately on each machine. [Remote machines](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/connecting-machines.mdx)

## Existing integration is not a status backend

Herdr's Claude Code integration provides session identity; its Pi integration provides lifecycle and session identity. Neither supplies this extension's rich status state or choices. Reuse their identity conventions, not their hooks as a ready-made status pane. [Integrations](https://raw.githubusercontent.com/herdrdev/herdr/v0.9.3/docs/next/website/src/content/docs/integrations.mdx), [Pi integration source](https://github.com/herdrdev/herdr/blob/7b116c05bfda646af39d2524c54e70c751f57ee8/src/integration/assets/pi/herdr-agent-state.ts)

## Recommendation

Prototype one explicitly invoked, read-only right split with live snapshots before adding reply transport or automatic lifecycle management. Test terminal resizing, focus, reconnects and cleanup in an isolated Herdr session. Approve that integration separately from the current Pi UI refinements.
