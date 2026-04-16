---
title: Contacts
description: Full CRUD for Apple Contacts with groups, search, and multi-field support.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_contacts` | List contacts with name, primary email, and phone. Supports pagination. | ✅ |
| `search_contacts` | Search contacts by name, email, phone, or organization. | ✅ |
| `read_contact` | Read full details of a contact by ID including all emails, phones, and addresses. | ✅ |
| `create_contact` | Create a new contact with name and optional email, phone, organization. | ❌ |
| `update_contact` | Update contact properties. Only specified fields are changed. | ❌ |
| `delete_contact` | Delete a contact by ID. This action is permanent. | ❌ |
| `list_groups` | List all contact groups. | ✅ |
| `add_contact_email` | Add an email address to an existing contact. | ❌ |
| `add_contact_phone` | Add a phone number to an existing contact. | ❌ |
| `list_group_members` | List contacts in a specific group. | ✅ |

## Quick Examples

```
// Find someone
"Search contacts for Alice Smith"

// Get full details
"Show me the full contact card for John Doe"

// Add a new contact
"Create a contact for Bob Lee with email bob@example.com"
```

## Permissions

Requires **Automation** permission for Apple Contacts (JXA path) or **Contacts** permission (Swift path).
