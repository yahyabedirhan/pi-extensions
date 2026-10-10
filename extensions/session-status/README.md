# session-status

Shows what the Pi session needs from you: open decisions, blockers, surprises, the session's own items and the pull requests and issues it touched. The agent keeps the status current with a `status` tool. You answer from an overlay, and your answer reaches the agent as your own prompt.

It is a port of the [session-status mod for Claude Code](https://github.com/yahyabedirhan/claude-mods/tree/main/plugins/session-status). The tool, its ids and its prompts are the same, so one set of agent instructions works in both harnesses.

## Try it and install it

```sh
# One run only, nothing installed:
pi -e git:github.com/yahyabedirhan/pi-extensions@v0.1.0
# From a clone:
pi -e ./extensions/session-status/index.ts

# Install for every session:
pi install git:github.com/yahyabedirhan/pi-extensions@v0.1.0
```

## What you see

A widget above the editor, drawn only while something is open:

```text
● Blocked · alt+s to answer
Blocked on you
  D1 Which database for the cache? · default: SQLite
You should know
  B1 The tests cannot run · needs: Install Node 22
Session  Progress 1/3 ████░░░░░░░░
  ○ I2 Write the cache layer
  ✓ I1 Read the spec
Effort  video-review  Closed 1/13 █░░░░░░░░░░░
Links  ⇄ widgets#12 · ◎ widgets#15
Decide before settling
  D2 Rename the flag? · default: Keep the name
Follow-up after settling
Surprises
  S1 CI runs Node 18 but the code needs Node 22 · → Pin Node 22
```

The footer shows the counts in one line: `1 blocked · 1 decide · progress 1/3 · 1 surprise`.

- **State**: Blocked, In progress, Settling, Waiting for reply or Settled, as in the mod.
- **Links**: `⇄` a pull request (green open, purple merged, red closed), `◎` an open issue, `⊙` a closed one. Each label is a terminal link to its page.
- Each list shows its newest few, then `+N more`. The overlay lists every open entry.

## Keys and commands

| Key or command | What it does |
|---|---|
| `alt+s` or `/session-status` | Opens the overlay. |
| `↑` `↓` (or `j` `k`) | Move in the overlay. |
| `Enter` | Open the entry's choices, or pick the selected choice. |
| `1`-`9` | Pick a choice by its number. |
| `Esc` (or `q`) | Go back to the list, then close. |
| `/session-status hide`, `show` | Hide or show the widget. The footer line stays. |
| `/session-status reset` | Clear the whole session status, as the mod's reset does. |

The overlay offers these choices, and sends the same prompts as the mod's pane buttons:

| Entry | Choice | Sends |
|---|---|---|
| Decision | an option (the default marked `✓`) | `D2: Yes`, and resolves the decision |
| Decision | Discuss | `Let's discuss D2: <question>`; the decision stays open, marked `(discussing)` |
| Surprise | its suggested action (30 characters or fewer) | `S1: Pin Node 22`, and dismisses it |
| Surprise | File issue | `File an issue for S1: <occurred>`, and dismisses it |
| Surprise | Discuss | `Let's discuss S1: <occurred>`; the surprise stays open |
| Surprise | Dismiss | nothing; dismisses it |
| Blocker | none | The agent resolves a blocker once it works. |

An answer given while the agent works waits until the turn ends (Pi's `followUp` delivery), as a mod button press does.

## What carries over from the Claude Code mod

| Mod feature | In Pi |
|---|---|
| `status` tool: every action, field, id and reply text | Same. The tool is `status`, not `mcp__session-status__status`. |
| System prompt section | Same text, added as a prompt section in `before_agent_start`. |
| Decisions, blockers, surprises, session items, decide list, `list`, `reset`, `create`/`read`/`update`/`delete` | Same. |
| Quick reply and surprise buttons | The overlay. Long options show too: the overlay has room for them. |
| Links from `gh pr create`, `gh issue create`, and `gh` merge, close and reopen | Same, read from the `bash` tool's output. Link states come from one `gh api graphql` read. |
| Effort: `effort:<name>` labels, `ticket` reports, the Building line, the tracker's count | Same. An effort skill counts as run when the agent reads its `SKILL.md`. |
| Settling and Settled | A `/skill:settle-session` or `/skill:settle-effort` prompt, or a read of their `SKILL.md`. |
| Pings for blocked decisions, blockers and the decide list | Same `shipyard ping` commands, skipped silently without `shipyard`. |
| Status per session id: resume restores, new and fork start empty, compact keeps | Same. Each change is saved as a custom session entry; `/tree` restores the status the branch saved. |

## What does not carry over

- **Tasks, cron jobs and subagents.** Pi has no task list, cron tools or subagent events, so nothing fills them. The kinds `task`, `cron` and `place` stay accepted by `create`, `read`, `update` and `delete`, so the action set stays compatible; the widget does not show them.
- **Places, the session ID, branch and worktree lines, Now, Answered and Last update.** Pi's footer shows the branch already. Places is a follow-up.
- **The observer.** The small model that looks for loops and side issues is not ported yet.
- **A side pane.** Pi has no docked pane, so the widget sits above the editor and the overlay answers.

## Privacy

- The status is saved in the Pi session file, as custom entries that never reach the model.
- `gh` and `git` run only to read link states, ticket counts and the branch name.
