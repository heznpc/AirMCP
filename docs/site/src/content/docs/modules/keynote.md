---
title: Keynote
description: Apple Keynote automation -- slides, presenter notes, add slides, export to PDF, start slideshows.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `keynote_list_documents` | List all open Keynote presentations. | ✅ |
| `keynote_create_document` | Create a new blank Keynote presentation. | ❌ |
| `keynote_list_slides` | List all slides in a Keynote presentation with title, body preview, and presenter notes. | ✅ |
| `keynote_get_slide` | Get detailed content of a specific slide including all text items and presenter notes. | ✅ |
| `keynote_add_slide` | Add a new slide to a Keynote presentation. | ❌ |
| `keynote_set_presenter_notes` | Set presenter notes on a specific slide. | ❌ |
| `keynote_export_pdf` | Export a Keynote presentation to PDF. Will overwrite an existing file at the same path. | ❌ |
| `keynote_start_slideshow` | Start playing a Keynote slideshow from a specific slide. | ❌ |
| `keynote_close_document` | Close an open Keynote presentation, optionally saving changes. | ❌ |

## Quick Examples

```
// Browse presentations
"List my open Keynote documents"

// Read slides
"Show me slide 3 of 'Q4 Review'"

// Edit
"Add presenter notes to slide 2: 'Remember to mention Q3 comparison'"

// Present
"Start the slideshow for 'Q4 Review' from slide 1"

// Export
"Export 'Q4 Review' to PDF at /tmp/presentation.pdf"
```

## Permissions

Requires **Automation** permission for Apple Keynote. Presentations must be open in Keynote to be accessed by these tools.
