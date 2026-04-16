---
title: Intelligence
description: Apple Intelligence features -- writing tools, text generation, image generation, document scanning, on-device AI chat, and planning.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `summarize_text` | Summarize text using Apple Intelligence (on-device Foundation Models). Requires macOS 26+ with Apple Silicon. | ✅ |
| `rewrite_text` | Rewrite text in a specified tone (professional, friendly, concise) using Apple Intelligence. | ✅ |
| `proofread_text` | Proofread and correct grammar/spelling using Apple Intelligence. | ✅ |
| `generate_text` | Generate text using Apple's on-device Foundation Model with custom system instructions. | ✅ |
| `generate_structured` | Generate structured JSON output from Apple's on-device Foundation Model with optional schema constraints. | ✅ |
| `tag_content` | Classify and tag content using Apple's on-device Foundation Model. Returns confidence scores for each tag. | ✅ |
| `ai_chat` | Send a message to an on-device AI session using Apple Foundation Models. Each call creates a fresh session. | ✅ |
| `generate_image` | Generate an image from a text description using Apple Intelligence on-device image generation (Image Playground). | ❌ |
| `scan_document` | Extract text and structure from an image file using Apple Vision framework OCR. | ✅ |
| `generate_plan` | Use Apple's on-device Foundation Model to generate a suggested plan of AirMCP tool calls. Does NOT execute anything. | ✅ |
| `ai_status` | Check availability and status of Apple's on-device Foundation Models. | ✅ |
| `ai_agent` | Run a prompt through Apple's on-device Foundation Models with access to AirMCP tools (Calendar, Reminders, Contacts). | ❌ |

## Quick Examples

```
// Writing tools
"Summarize this text: ..." / "Rewrite this email in a friendly tone"

// AI generation
"Generate a haiku about cherry blossoms using the on-device model"

// Document scanning
"Scan the document at /tmp/receipt.jpg and extract the text"

// Planning
"Generate a plan to organize my day based on my calendar and reminders"
```

## Permissions

Requires **macOS 26 (Tahoe) or later** with **Apple Silicon**. All processing runs entirely on-device via Apple Foundation Models. No API keys required. The `scan_document` tool uses the Vision framework and works on macOS 14+.
