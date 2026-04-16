---
title: Safari
description: Tab management, bookmarks, reading list, page content reading, and JavaScript execution.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_tabs` | List all open tabs across all Safari windows with title and URL. | ✅ |
| `read_page_content` | Read the HTML source of a Safari tab. Specify window and tab index from list_tabs. | ✅ |
| `get_current_tab` | Get the title and URL of the active Safari tab. | ✅ |
| `open_url` | Open a URL in Safari's frontmost window. Blocks non-HTTP schemes and internal network addresses. | ❌ |
| `close_tab` | Close a specific Safari tab. | ❌ |
| `activate_tab` | Switch to a specific Safari tab. | ❌ |
| `run_javascript` | Execute JavaScript in a Safari tab. Requires `allowRunJavascript` config. | ❌ |
| `search_tabs` | Search open Safari tabs by title or URL keyword. | ✅ |
| `list_bookmarks` | List all Safari bookmarks across all folders, including subfolder paths. | ✅ |
| `add_bookmark` | DEPRECATED: Safari removed bookmark scripting in macOS 26. Use `add_to_reading_list` instead. | ❌ |
| `list_reading_list` | List all items in Safari's Reading List. | ✅ |
| `add_to_reading_list` | Add a URL to Safari's Reading List with an optional title. | ❌ |

## Quick Examples

```
// View open tabs
"List all my open Safari tabs"

// Read a page
"Read the content of my current Safari tab"

// Open a page
"Open https://developer.apple.com in Safari"

// Save for later
"Add the current page to my Reading List"
```

## Permissions

Requires **Automation** permission for Safari. The `run_javascript` tool requires `allowRunJavascript: true` in config or `AIRMCP_ALLOW_RUN_JAVASCRIPT=true` environment variable. URL opening is restricted to `http://` and `https://` schemes and blocks localhost, private networks, and cloud metadata endpoints.
