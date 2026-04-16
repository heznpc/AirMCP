---
title: Pages
description: Apple Pages automation -- list, create, read/write body text, export to PDF, and close documents.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `pages_list_documents` | List all open Pages documents with name, path, and modified status. | ✅ |
| `pages_open_document` | Open a Pages document from a file path. | ❌ |
| `pages_create_document` | Create a new blank Pages document. | ❌ |
| `pages_get_body_text` | Get the body text content of an open Pages document. | ✅ |
| `pages_set_body_text` | Replace the body text of an open Pages document. | ❌ |
| `pages_export_pdf` | Export an open Pages document to PDF. Will overwrite an existing file at the same path. | ❌ |
| `pages_close_document` | Close an open Pages document, optionally saving changes. | ❌ |

## Quick Examples

```
// Browse documents
"List my open Pages documents"

// Read content
"Get the body text of 'Untitled'"

// Create and write
"Create a new Pages document and set its body text to 'Hello World'"

// Export
"Export 'My Report' to PDF at /tmp/report.pdf"
```

## Permissions

Requires **Automation** permission for Apple Pages. Documents must be open in Pages to be accessed by these tools.
