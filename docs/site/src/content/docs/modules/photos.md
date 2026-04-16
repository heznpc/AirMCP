---
title: Photos
description: Albums, search, favorites, photo info, import, delete, advanced queries, and image classification.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_albums` | List all photo albums with name and item count. | ✅ |
| `list_photos` | List photos in an album with metadata. | ✅ |
| `search_photos` | Search photos by filename, name, or description keyword. | ✅ |
| `get_photo_info` | Get detailed metadata for a specific photo by ID. | ✅ |
| `list_favorites` | List photos marked as favorites. | ✅ |
| `create_album` | Create a new photo album. | ❌ |
| `add_to_album` | Add photos to an existing album by photo IDs and album name. | ❌ |
| `import_photo` | Import a photo from a file path into Photos library. Optionally add to an existing album. Requires macOS 26+ Swift bridge. | ❌ |
| `delete_photos` | Delete photos by local identifier. Shows macOS confirmation dialog for user approval. Requires macOS 26+ Swift bridge. | ❌ |
| `query_photos` | Query the Photos library with filters: media type, date range, favorites. Requires Swift bridge. | ✅ |
| `classify_image` | Classify an image using Apple Vision framework. Returns labels with confidence scores. Requires Swift bridge. | ✅ |

## Quick Examples

```
// Browse albums
"List my photo albums"

// Search
"Search for photos named 'vacation'"

// Organize
"Create an album called 'Best of 2025' and add my favorite photos to it"

// Image analysis
"Classify the image at /tmp/photo.jpg"
```

## Permissions

Requires **Automation** permission for Photos (JXA path) or **Photos Library** permission (Swift/PhotoKit path). The `import_photo`, `delete_photos`, `query_photos`, and `classify_image` tools require the macOS 26+ Swift bridge.
