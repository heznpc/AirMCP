# AirMCP Workflow Guide

AirMCP is useful when an AI client needs to work across your Apple workspace, not just answer a question about one app. The product shape is:

- Siri and Shortcuts can be the Apple-native front door.
- Claude, Codex, Cursor, Raycast, and other MCP clients can be the external agent brain.
- AirMCP supplies the local action runtime: Apple app access, workflow skills, semantic memory, approvals for sensitive actions, audit logs, rate limits, and OAuth scopes.

This is not positioned as a Siri replacement. Siri can launch or phrase a workflow; AirMCP gives that workflow governed hands across Notes, Calendar, Reminders, Mail, Safari, Finder, Contacts, and the Swift-backed Apple frameworks.

## Target Users

**Apple workspace power users**

People who already keep their calendar, notes, reminders, mail, files, contacts, and Safari context inside Apple apps. They do not need a new productivity database; they need a safe agent layer over the data they already use.

**Agent-native developers and operators**

People who live in Codex, Claude Code, Cursor, Raycast, or terminal agents and want those agents to act on local Apple context without writing one-off AppleScript glue for every task.

**Privacy-sensitive prosumers**

People who are willing to use cloud AI clients, but want local controls around what gets read, what gets written, what requires approval, and what remains auditable after the fact.

## First-Class Workflows

These are the workflows AirMCP should make obvious in product, docs, demos, and registry copy.

| Workflow | Type | Required modules | Core tools and skills | Safety shape |
| --- | --- | --- | --- | --- |
| Daily Briefing | built-in-skill | `calendar`, `reminders`, `mail`, `notes` | `skill_daily-briefing`, `summarize_context`, `today_events`, `list_reminders`, `get_unread_count`, `list_notes` | Read-only by default; saving a note or reminder is a separate write action. |
| Inbox Triage | built-in-skill | `mail`, `reminders` | `skill_inbox-triage`, `skill_sender-to-tasks`, `search_messages`, `create_reminder` | Reads mail first; reminder creation is auditable and prompts per call at the default HITL level. |
| Meeting Prep | prompt-recipe | `calendar`, `notes`, `contacts`, `finder`, `reminders` | `today_events`, `search_notes`, `search_contacts`, `recent_files`, `list_reminders` | Read-only prep flow; agenda or task creation is an explicit follow-up write. |
| Project Digest | built-in-skill | `memory`, `notes`, `calendar`, `reminders`, `mail`, `finder` | `semantic_index`, `skill_project-digest`, `semantic_search`, `find_related` | Digest is read-only after indexing; indexing writes only to AirMCP's local semantic store. |
| Focus Blocks | built-in-skill | `reminders`, `calendar` | `skill_focus-block-planner`, `list_reminders`, `create_event` | Calendar writes are non-destructive but sensitive, so each created event prompts at the default HITL level. |
| Research to Output | prompt-recipe | `safari`, `intelligence`, `notes`, `mail` | `list_tabs`, `read_page_content`, `summarize_text`, `create_note`, `send_mail` | Reading and summarizing are read-only. Sending or saving output is a separate HITL-gated action. |

## Copyable Prompts

- **Daily Briefing**: "Brief me on today's calendar, overdue reminders, unread mail, and recent notes."
- **Inbox Triage**: "Find emails from Alex about the project and create reminders for action items."
- **Meeting Prep**: "For my next meeting, find related notes, contacts, files, and reminders."
- **Project Digest**: "Summarize what changed since yesterday on my current project."
- **Focus Blocks**: "Plan focus blocks for today's open reminders, but ask before creating each event."
- **Research to Output**: "Open the Apple developer docs in Safari, summarize the page, and draft a note."

## How Users Run Them

```bash
npx airmcp workflows
npx airmcp workflows daily-briefing --prompt
npx airmcp workflows daily-briefing --preview
npx airmcp workflows meeting-prep --modules
npx airmcp workflows inbox-triage --tools
npx airmcp workflows project-digest --json
```

The CLI prints the same curated workflow catalog that the macOS menubar app exposes under **Workflows**. Each workflow includes a copyable prompt, core tools, optional Siri phrase, and safety note.

Use a workflow id with `--prompt`, `--siri`, `--tools`, `--modules`, `--safety`, or `--json` when you want only one field for a shell script, launcher, onboarding screen, or agent prompt. `daily-briefing --preview` performs a real read-only snapshot of Calendar, Reminders, Mail, and Notes; it does not write data.

For Codex:

```bash
codex mcp add --env AIRMCP_HTTP_TOKEN=<token> airmcp -- npx -y airmcp connect --url http://127.0.0.1:3847/mcp
```

For Claude Code:

```bash
claude mcp add --env AIRMCP_HTTP_TOKEN=<token> airmcp -- npx -y airmcp connect --url http://127.0.0.1:3847/mcp
```

For Siri and Shortcuts, see [shortcuts.md](shortcuts.md). The default AppShortcuts are workflow-first; `Ask AirMCP` is a separate FoundationModels preview shortcut that only appears in opt-in builds with `AIRMCP_ENABLE_FOUNDATION_MODELS`.

## What Exists Today

- CLI workflow catalog SSOT: `src/cli/workflows-catalog.json`
- CLI workflow renderer and preview runner: `src/cli/workflows.ts`
- Menubar Workflows menu: `app/Sources/AirMCPApp/Views/MenuContent.swift`
- Built-in workflow skills: `src/skills/builtins/*.yaml`
- Workflow safety annotations for exposed skills: `src/skills/types.ts`, `src/skills/register.ts`
- Auto-generated AppIntents and workflow-first AppShortcuts: `scripts/gen-swift-intents.mjs`
- Codex setup support: `src/cli/codex-mcp.ts`, `src/cli/init.ts`, `src/cli/doctor.ts`

## Product Direction

The next product work should improve access and confidence around these workflows, rather than adding another broad batch of low-level tools.

- Make the first-run experience ask "what workflow do you want AirMCP for?" instead of only "which modules do you want?"
- Let the menubar app run or copy workflows for specific clients: Codex, Claude, Cursor, Raycast, and Shortcuts.
- Keep required approvals scoped to the individual gated call. Do not solve approval fatigue by silently broadening approval scope; improve prompt wording, grouping, and denial recovery instead.
- Make audit review human-readable for workflow runs, not just individual tool calls.
- Treat FoundationModels host mode as preview until the Swift toolchain and platform APIs are stable enough for default builds.
