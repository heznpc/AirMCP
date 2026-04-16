---
title: Mail
description: Read mailboxes, search messages, get unread count. Send and reply when allowSendMail is enabled.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_mailboxes` | List all mailboxes across accounts with unread counts. | ✅ |
| `list_messages` | List recent messages in a mailbox (e.g. 'INBOX'). Returns subject, sender, date, read status. | ✅ |
| `read_message` | Read full content of an email message by ID. Content length is configurable (default: 5000 chars, max: 100000). | ✅ |
| `search_messages` | Search messages by keyword in subject or sender within a mailbox. | ✅ |
| `mark_message_read` | Mark an email message as read or unread. | ❌ |
| `flag_message` | Flag or unflag an email message. | ❌ |
| `get_unread_count` | Get unread message count across all mailboxes. | ✅ |
| `move_message` | Move a message to another mailbox. | ❌ |
| `list_accounts` | List all mail accounts. | ✅ |
| `send_mail` | Compose and send an email via Apple Mail. Requires `allowSendMail` config. | ❌ |
| `reply_mail` | Reply to an email message. Requires `allowSendMail` config. | ❌ |

## Quick Examples

```
// Check inbox
"How many unread emails do I have?"

// Read messages
"Show me the latest messages in my inbox"

// Search
"Search for emails from alice@example.com about 'quarterly report'"
```

## Permissions

Requires **Automation** permission for Apple Mail. The `send_mail` and `reply_mail` tools require `allowSendMail: true` in config or `AIRMCP_ALLOW_SEND_MAIL=true` environment variable.
