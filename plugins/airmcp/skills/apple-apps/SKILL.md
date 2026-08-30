---
name: apple-apps
description: Use AirMCP to find, read, and carefully change information in Apple apps on the user's Mac, including Notes, Reminders, Calendar, Finder, Shortcuts, and screen capture. Trigger when the user asks to inspect or act on data in those apps. Do not trigger for general knowledge, web-only tasks, or iOS Simulator and device control.
---

# Apple apps through AirMCP

Use the AirMCP tools exposed in the current conversation as a maintained, permission-aware bridge to Apple apps on the user's Mac. AirMCP is a capability layer, not the assistant itself.

## Establish the available surface

1. Inspect the AirMCP tools that are actually available in this conversation.
2. When the required tool is not obvious, call `discover_tools` with a short capability query such as `notes search`, `calendar events`, `finder files`, or `shortcuts`.
3. If availability is still unclear and `profile_status` is exposed, use it to explain which runtime profile and modules are active.
4. Never claim that AirMCP supports an action merely because the target is an Apple app. If no suitable tool is exposed, say so and name the missing capability.

Do not use an unrelated UI, shell, browser, or messaging tool as a silent fallback for a missing AirMCP capability.

## Read and identify before acting

Use the narrowest read path that can identify the requested object:

- Notes: search or list first, then read the selected note by ID before comparing, updating, moving, or deleting it.
- Reminders: search or list first, then read the selected reminder by ID before completing, updating, or deleting it.
- Calendar: list or search the requested date range, then read an event by ID before updating or deleting it.
- Finder: search or list candidates, then inspect the exact path and file details before moving, tagging, or trashing it.
- Shortcuts: list or search by name, then inspect details before running, editing, duplicating, exporting, or deleting a shortcut.

If a read result returns multiple plausible matches, present the distinguishing fields and ask the user to choose. Reuse stable IDs or exact absolute paths from the read result in subsequent calls; do not reconstruct them from memory.

## Mutation and approval boundary

Before every create, update, complete, move, send, run, overwrite, trash, or delete call:

1. State the exact target and the effect of the pending tool call.
2. Show the fields or content that will be written. For messages, include the exact recipients, subject, and body. For dates, include the date, time, and timezone. For files, include the absolute path.
3. For any outbound send, Shortcut run, delete, file trash, or content overwrite, always ask for a fresh explicit confirmation immediately before every call, even when the user requested the action earlier. For other mutations, ask when the exact target and effect have not already been confirmed in the current turn. A vague request such as "clean these up" is not confirmation.
4. Respect AirMCP's own HITL approval. Never retry around a denial, timeout, unavailable approval channel, or permission failure. Explain the returned failure and stop.
5. After an approved call, report the returned result. Do not claim success when the tool reports an error or when no tool call was made.

Treat outbound sends, running a Shortcut, deleting Apple data, overwriting note content, and trashing files as consequential even when the underlying tool's annotation appears permissive.

## Permission-aware handling

macOS permissions belong to the process that performs the work. For this plugin path, that should be the signed AirMCP app-owned runtime. When a tool returns a permission error:

- Name the permission in the error and the signed AirMCP app as the expected permission subject when the result supports that conclusion.
- Do not tell the user that a device capability check proves authorization.
- Do not switch to a direct terminal or client-owned runtime to bypass the permission failure.
- Ask the user to grant or review the permission in macOS, then retry only after they say it is ready.

## Product boundary

AirMCP can expose Apple-app data and macOS actions that the active runtime actually advertises. It does not provide native iOS Simulator or physical-device booting, tapping, swiping, app installation, or debugger control. Do not route those requests through screen capture or generic UI tools and do not imply that a screenshot proves simulator control.

For general knowledge, web research, coding, or unrelated cloud services, do not invoke this skill or AirMCP tools unless the user explicitly asks to use Apple-app data as part of the task.
