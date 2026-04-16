---
title: Messages
description: List chats, read messages, search chats. Send iMessages when allowSendMessages is enabled.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_chats` | List recent chats in Messages with participants and last update time. | ✅ |
| `read_chat` | Read chat details including participants and last update time by chat ID. | ✅ |
| `search_chats` | Search chats by participant name, handle, or chat name. | ✅ |
| `send_message` | Send a text message via iMessage/SMS. Requires a phone number or email as the target handle. | ❌ |
| `send_file` | Send a file attachment via iMessage/SMS. Requires absolute file path and recipient handle. | ❌ |
| `list_participants` | List all participants in a specific chat. | ✅ |

## Quick Examples

```
// View chats
"List my recent chats"

// Search
"Search chats for messages with Alice"

// Send (requires opt-in)
"Send a message to +821012345678 saying 'I'll be there in 10 minutes'"
```

## Permissions

Requires **Automation** permission for Messages app. The `send_message` and `send_file` tools require `allowSendMessages: true` in config or `AIRMCP_ALLOW_SEND_MESSAGES=true` environment variable.
