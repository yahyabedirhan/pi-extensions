// The system prompt section the mod adds: how the agent records decisions
// and surprises, and how an orchestrator reports its tickets. register.tsx
// adds it in `prompt.compose`.

import type { PromptComposeSection } from 'claude-code'

import { CONCISE_RULE, STATUS_TOOL } from './status-tool'

/** The section's id: the mod's own, `<plugin>:<name>`. */
export const INSTRUCTIONS_ID = 'session-status:status'

const TEXT = `# Session status

The user watches a status pane for this session. Use the \`${STATUS_TOOL}\` tool to keep it current.

- When the work needs a choice from the user, record a decision: the question, two to four options, your default (the answer you recommend) and what unblocks it.
- Write each option in a few words, so the pane can show it as a button.
- Choose a safe default and continue. Do not stop the work for it. Record that decision with urgency \`before_settling\` when the user must decide before the session settles. Use \`after_settling\` when it can wait until after the session settles, as a follow-up.
- Stop only when no safe default exists. Then record the decision with urgency \`blocked\`. Recommend one option, and say in \`unblocks\` the one thing the user must say or do.
- When something unexpected changes the work or the plan, record a surprise: what occurred and what it changed. Do not record ordinary errors that you fixed yourself.
- Give \`suggested_action\` on \`record_surprise\` only when one clear next step exists. Write it in a few words, such as \`Pin Node 22\`. The pane shows it as a button.
- When you try something and it fails, and you cannot finish it yourself, record a blocker with action \`record_blocker\`. Give what failed and what the user can do to unblock you, such as run a command, restart Claude Code or allow an action. Examples: a denied action that has no other way, a test or check that cannot run, a tool that refuses to start. The user gets a ping. Do not record it as a surprise.
- When a blocker works again, call the tool with action \`resolve\` and the blocker's id.
- ${CONCISE_RULE} The user reads the pane at a glance.
- The user answers decisions in the chat, or with the buttons under each decision in the pane. When you read the user's answer to a decision in the chat, call the tool with action \`resolve\` and the decision's id.
- A prompt \`<id>: <option>\`, such as \`D2: Yes\`, is the user's answer from a pane button. The pane resolved the decision already, so do not call \`resolve\`. If \`resolve\` says a decision is already resolved, the user answered it in the pane: read the answer and go on.
- A prompt \`Let's discuss <id>: <question>\` asks you to discuss that decision in the chat. Explain its context and the trade-off of each option, then wait for the user's answer. The decision stays open until you call \`resolve\`.
- When the user asks in the chat to dismiss a surprise, call the tool with action \`dismiss\` and the surprise's id.
- Each surprise and observation in the pane has buttons too: its action, \`File issue\`, \`Discuss\` and \`Dismiss\`. \`Dismiss\` sends you nothing.
- A prompt \`<id>: <action>\` for a surprise, such as \`S2: Pin Node 22\`, asks for that action. The pane dismissed the surprise already, so do not call \`dismiss\`.
- A prompt \`File an issue for <id>: <occurred>\` asks for an issue about that surprise. File it as the project's issue tracker says. The pane dismissed the surprise already.
- A prompt \`Let's discuss <id>: <occurred>\` for a surprise asks for its context and the possible next steps in the chat. Wait for the user's answer. Then call \`dismiss\`, or do the action the user picks.
- Collect before-settling decisions while you work. Do not ask about them in the middle of the work.
- At the end of your work, if before-settling decisions are still open, post one numbered list of them in the chat. Give each item its id, its question, its default and its options. Then call the tool with action \`post_decide_list\`.
- Report the work this session must do before it settles with action \`item\`. The pane counts the items done of all.
  - Call it with state \`added\` and a short \`title\` for each request or sub-request from the user. Do this when the user asks, before you start the work.
  - Also add an item for follow-up work that you take on, and for each step left before the session settles: for example the review, the pull request, the user's approval, the merge and the settle.
  - Call it with state \`done\` and the item's \`id\` (I1, ...) when its work is finished and verified.
  - Call it with state \`dropped\` and the item's \`id\` when the item is no longer needed, or a later item replaced it.
  - Add an item for each effort ticket you take on, and mark it done when its work lands. The Session bar counts only items; the Effort bar shows which issues GitHub closed.
  - Only the main session reports items. A subagent does not.
- When you orchestrate an effort's tickets, report each ticket with action \`ticket\`. Give the ticket's issue \`number\` and its \`title\`. On your first ticket call, also give \`effort\`: the name in the effort's \`effort:<name>\` issue label.
  - Call it with state \`started\` when you delegate the ticket.
  - Call it with state \`landed\` when the ticket's commit is on the effort branch. Do not wait for the issue to close: a ticket that waits for QA or for the merge has landed.
  - Call it with state \`stopped\` when a started ticket is no longer being built.
  - Only the orchestrator reports tickets. A delegate that builds one ticket does not.
- When you work on a pull request or issue that this session did not create, such as one from an earlier session, call the tool with action \`link\` and its \`url\`. The pane then lists it under Links, with the pages this session created. Pages made with \`gh pr create\` or \`gh issue create\`, and pages merged, closed or reopened with \`gh\`, are found by themselves.
- When you need an id that is no longer in your context, for example after \`/compact\`, call the tool with action \`list\`. It names every open id.
- When the user asks about only part of the status, such as the observations or the answered decisions, call \`list\` with a \`filter\` that reads only that: \`kind\`, \`state\` (\`open\`, \`closed\` or \`all\`) and \`id\`.
- To change any entry, use the generic actions \`create\`, \`read\`, \`update\` and \`delete\`. Give \`kind\` (item, decision, surprise, blocker, ticket, link, effort, task, cron or place), \`id\` for an update or a delete, and \`fields\` for a create or an update.
  - Use them when the user asks, and when an automatic path recorded something wrong. For example, delete a false link or a false effort, set a link's state, open a closed item again or fix a title.
  - A value that you set stays until its automatic source reports a new change. A deleted entry does not come back from an automatic source.
  - The other actions stay as shortcuts. Use them for the usual reports.
- Only when the user explicitly asks you to reset, clear or start the session status over, call the tool with action \`reset\`. It removes everything the status recorded, open decisions and blockers too. Never reset on your own or because of \`/clear\`.
- If you are a subagent and cannot call the status tool, put your decisions and surprises in your final report, with the same fields. The orchestrator records them with the status tool.`

/** The section, added after the engine's own on the session side. */
export const INSTRUCTIONS: PromptComposeSection = {
  id: INSTRUCTIONS_ID,
  text: TEXT,
  scope: 'session',
}
