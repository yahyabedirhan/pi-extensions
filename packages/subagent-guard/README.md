# subagent-guard

Keeps the subagents of [@tintinweb/pi-subagents](https://www.npmjs.com/package/@tintinweb/pi-subagents) inside your `tool_call` guardrail.

A guardrail extension that gates tools through `pi.on("tool_call")` also gates a subagent's tools, because a child session loads the extensions too. pi-subagents has a few ways to start a child without them, or to run work outside `tool_call` altogether. This extension closes those paths. It was written against pi-subagents 0.20.0.

## Try it and install it

```sh
# From the repository root, one run next to pi-subagents:
pi -e ./packages/subagent-guard -e npm:@tintinweb/pi-subagents@0.20.0

# Install this package only:
pi install ./packages/subagent-guard
```

From this package directory, use `pi -e .` or `pi install .` instead. Local installs load from the clone; keep it in place and update it with `git pull`. This package does not load Session Status. Its private npm name is a local placeholder; no registry release is approved.

Load it in the same places as your guardrail, so the children load it too.

## What it does

| Path out of the guardrail | What subagent-guard does |
|---|---|
| `Agent` with `isolated: true`: the child loads no extensions | Blocks the call. The reason tells the agent to call again without it. |
| `Agent` with `isolation: "worktree"`: the result is committed with `git commit --no-verify`, outside `tool_call` | Blocks the call. |
| `Agent` with `schedule`: the agent runs later, unreviewed | Blocks the call. |
| An agent file that sets `isolated: true`, `extensions: false` or `none`, `exclude_extensions`, a narrowed `extensions` list or `isolation: worktree` | Blocks an `Agent` call of that type and names the file. A project file in `.pi/agents/` or `.agents/agents/` overrides a global or built-in agent of the same name, `general-purpose` too. |
| `SubagentWorkflow`: workflow `gate` commands run through `pi.exec("sh -c ...")` | Blocks the call. |
| `edit` or `write` to `.pi/subagents.json`, `.pi/agents/`, `.agents/agents/`, `.pi/workflows/` or `.agents/workflows/` in any project, or to `agents/`, `workflows/` or `subagents.json` in Pi's agent dir | Asks you first, with "No" as the first choice. Blocks when there is no UI to ask. |
| A project's agent files or `.pi/subagents.json` (which overrides your global `subagents.json`) turn on `isolated`, drop extensions, or set `workflowsEnabled`, `worktreeIsolation` or `schedulingEnabled` to `true` | Warns once at session start. It does not block. |

The nested `Agent` tool a child gets passes through `tool_call` in the child, so the same blocks apply there. Every other tool passes untouched.

## Protected extensions

By default any agent file that drops or narrows a child's extensions counts. To count only the extensions that must stay, name them:

```sh
export PI_SUBAGENT_GUARD_PROTECT="my-guardrail"
```

Use each extension's canonical name: its file name without `.ts`, or its folder name for an `index.ts`. `subagent-guard` is added to the list.

## What it does not cover

- `bash` that writes the protected files, for example `echo ... > .pi/subagents.json`. Shell commands are too varied to match reliably; let your guardrail gate `bash`.
- pi-subagents' cross-extension RPC (`subagents:rpc:spawn`), which another extension calls without a tool call.
- `@name` mentions in `direct` mode, which start an agent from what you type, not from a tool call.
- Agent files that already exist when you load it: those it warns about or blocks at call time, but it does not change them.

If a handler throws, Pi does not run the tool, so an error inside the guard blocks rather than lets the call through.
