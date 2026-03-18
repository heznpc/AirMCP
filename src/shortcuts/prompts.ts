import type { McpServer } from "../shared/mcp.js";
import { z } from "zod";

import { userPrompt } from "../shared/prompt.js";

export function registerShortcutPrompts(server: McpServer): void {
  server.prompt(
    "shortcut-automation",
    {
      goal: z.string().describe("The automation goal or workflow you want to achieve"),
      input: z.string().optional().describe("Optional initial input data for the workflow"),
    },
    ({ goal, input }) => {
      const inputCtx = input ? `\nInitial input data: "${input}"` : "";
      return userPrompt(
        "Guide for creating complex automation workflows by chaining multiple shortcuts.",
        `Build an automation workflow to achieve: "${goal}"${inputCtx}

Execute the following steps using AirMCP tools:

1. **Discover available shortcuts**:
   - list_shortcuts to get all available Siri Shortcuts on this Mac
   - search_shortcuts with keywords related to "${goal}" to find relevant shortcuts
   - For each promising match, use get_shortcut_detail to understand what it does and what actions it contains

2. **Analyze and plan the workflow**:
   - Identify which shortcuts can be chained together to accomplish the goal
   - Determine the execution order based on input/output dependencies
   - Note which shortcuts accept text input and which produce output
   - Identify any gaps where no existing shortcut covers a needed step
   - Present the proposed workflow plan to me for confirmation

3. **Execute the workflow**:
   - Run each shortcut in sequence using run_shortcut with the appropriate name and input
   - Pass the output of one shortcut as the input to the next when chaining
   - If a shortcut fails, report the error and suggest alternatives
   - Track the output at each step for the final summary

4. **Report results**:
   - Show the output from each step in the chain
   - Highlight any steps that produced unexpected results
   - Suggest improvements or additional shortcuts that could enhance the workflow
   - If a step failed, explain what went wrong and possible fixes

Important:
- Always use exact shortcut names from list_shortcuts or search_shortcuts — names must match exactly
- Some shortcuts may trigger UI prompts or require user interaction — warn me before running those
- Never assume a shortcut exists; always verify with search_shortcuts first
- Ask for confirmation before running shortcuts that perform destructive or irreversible actions

Error handling:
- If a tool call fails, inform the user and try an alternative (e.g., if run_shortcut fails, try search_shortcuts to verify the name)
- On permission errors, guide the user to setup_permissions
- If an app is unresponsive, skip to the next step`,
      );
    },
  );

  server.prompt(
    "shortcut-discovery",
    {
      category: z.string().optional().describe("Optional category or keyword to focus the discovery (e.g. 'productivity', 'media', 'text')"),
    },
    ({ category }) => {
      const filterCtx = category
        ? `Focus on shortcuts related to "${category}".`
        : "Cover all available shortcuts.";
      return userPrompt(
        "Help users find, understand, and explore their available Siri Shortcuts.",
        `Help me discover and understand my available Siri Shortcuts. ${filterCtx}

Execute the following steps using AirMCP tools:

1. **List all shortcuts**:
   - list_shortcuts to get the complete list of Siri Shortcuts on this Mac
   - Report the total count${category ? `\n   - search_shortcuts(query: "${category}") to filter for the relevant category` : ""}

2. **Categorize shortcuts**:
   - Group shortcuts by inferred purpose based on their names:
     * Productivity (text processing, file operations, data conversion)
     * Communication (messaging, email, sharing)
     * Media (photos, music, video)
     * System (settings, device control, automation)
     * Developer (build, deploy, git, code)
     * Custom/Other
   - Present the categorized list clearly

3. **Deep-dive into interesting shortcuts**:
   - For shortcuts with unclear names, use get_shortcut_detail to inspect their actions
   - Identify which shortcuts accept input and what type
   - Identify which shortcuts produce output
   - Flag shortcuts that might interact with external services or perform system changes

4. **Provide recommendations**:
   - Suggest useful shortcuts the user might not know they have
   - Identify shortcuts that could be combined for powerful workflows
   - Point out shortcuts that overlap in functionality
   - Suggest common tasks that could be automated with the existing shortcuts

5. **Summary report**:
   - Total shortcuts available
   - Breakdown by category
   - Top recommendations for daily use
   - Potential workflow combinations

Important:
- Use get_shortcut_detail on shortcuts with ambiguous names to provide accurate descriptions
- Do not run any shortcuts during discovery — this is a read-only exploration
- If the list is very large, focus on the most useful categories first

Error handling:
- If a tool call fails, inform the user and try an alternative (e.g., if get_shortcut_detail fails, use search_shortcuts for basic info)
- On permission errors, guide the user to setup_permissions
- If an app is unresponsive, skip to the next step`,
      );
    },
  );

  server.prompt(
    "shortcut-troubleshooting",
    {
      shortcutName: z.string().describe("Name of the shortcut that is having issues"),
      errorDescription: z.string().optional().describe("Description of the error or unexpected behavior"),
    },
    ({ shortcutName, errorDescription }) => {
      const errorCtx = errorDescription
        ? `\nReported issue: "${errorDescription}"`
        : "";
      return userPrompt(
        "Diagnose and fix shortcut execution issues.",
        `Troubleshoot the Siri Shortcut "${shortcutName}".${errorCtx}

Execute the following steps using AirMCP tools:

1. **Verify the shortcut exists**:
   - search_shortcuts(query: "${shortcutName}") to find the shortcut
   - If not found, list_shortcuts to show all available shortcuts and suggest the closest match
   - Confirm the exact name (names are case-sensitive and must match exactly)

2. **Inspect the shortcut**:
   - get_shortcut_detail(name: "${shortcutName}") to examine its actions and structure
   - Identify what the shortcut is designed to do
   - Check what input it expects (if any)
   - Identify actions that depend on external services, apps, or permissions

3. **Test execution**:
   - run_shortcut(name: "${shortcutName}") with no input to test basic execution
   - If the shortcut expects input, run_shortcut with a simple test input
   - Capture and analyze any error messages from the output

4. **Diagnose the issue**:
   Based on the inspection and test results, check for these common problems:
   - **Name mismatch**: The name used doesn't exactly match the shortcut name
   - **Missing input**: The shortcut requires input but none was provided
   - **Wrong input type**: The shortcut expects a specific input format
   - **Permission issues**: The shortcut needs permissions that haven't been granted
   - **App dependency**: The shortcut relies on an app that isn't installed or available
   - **Network dependency**: The shortcut needs internet access for an API or web request
   - **UI interaction required**: The shortcut triggers a dialog that blocks automation
   - **Timeout**: The shortcut takes too long to complete via CLI

5. **Provide solutions**:
   - Explain the diagnosed root cause clearly
   - Suggest specific fixes:
     * Correct name to use with run_shortcut
     * Required input format and example
     * Permission steps to resolve access issues
     * Alternative shortcuts that accomplish the same goal
   - If the shortcut cannot be fixed via MCP, explain what manual steps are needed in the Shortcuts app

6. **Verification**:
   - After applying fixes, re-run the shortcut to confirm it works
   - Show the successful output

Important:
- Some shortcuts will trigger UI prompts — warn me before running them
- If a shortcut consistently fails, it may need to be edited in the Shortcuts app directly
- Report the exact error output for accurate diagnosis
- Do not modify or delete any shortcuts — only inspect and run them

Error handling:
- If a tool call fails, inform the user and try an alternative (e.g., if search_shortcuts fails, use list_shortcuts and filter manually)
- On permission errors, guide the user to setup_permissions
- If an app is unresponsive, skip to the next step`,
      );
    },
  );
}
