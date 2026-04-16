---
title: Finder
description: File system operations including search, directory listing, recent files, file tags, and move/trash.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `search_files` | Search files using Spotlight (mdfind). Searches file names and content. | ✅ |
| `get_file_info` | Get detailed file information including size, dates, kind, and tags. | ✅ |
| `set_file_tags` | Set Finder tags on a file. Replaces all existing tags. | ❌ |
| `recent_files` | Find recently modified files in a folder using Spotlight. | ✅ |
| `list_directory` | List files and folders in a directory with metadata (kind, size, modification date). | ✅ |
| `move_file` | Move or rename a file or folder to a new location. | ❌ |
| `trash_file` | Move a file or folder to the Trash using Finder. | ❌ |
| `create_directory` | Create a new directory (and intermediate directories if needed). | ❌ |

## Quick Examples

```
// Search for files
"Search for PDF files about 'quarterly report' in my Documents folder"

// Recent activity
"Show me files modified in the last 3 days on my Desktop"

// File info
"Get the file info for /Users/me/Documents/report.pdf"

// Organize
"Move all .png files from Downloads to Pictures"
```

## Permissions

Requires **Automation** permission for Finder. File paths are validated to prevent path traversal attacks.
