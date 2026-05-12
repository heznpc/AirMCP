---
title: Podcasts
description: Podcast shows, episodes, playback control, and episode search.
---

:::caution[Deprecated on macOS 26+]
Apple removed the entire Podcasts JXA scripting dictionary in macOS 26 (Tahoe).
All six Podcasts tools are **skipped at module registration** on macOS 26+
(see `compatibility.brokenOn: [26]` in [`src/shared/modules.ts`](https://github.com/heznpc/AirMCP/blob/main/src/shared/modules.ts)).
They remain available on macOS ≤ 25 hosts.

- **Deprecated since:** v2.11.0
- **Removed at:** v3.0.0
- **Replacement:** investigating Shortcuts bridge or Media framework alternatives
- **Surfaced by:** `airmcp doctor` and `print-compat-report`
:::

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_podcast_shows` | List all subscribed podcast shows with episode counts. | ✅ |
| `list_podcast_episodes` | List episodes of a podcast show with title, date, duration, and played status. | ✅ |
| `podcast_now_playing` | Get the currently playing podcast episode and playback state. | ✅ |
| `podcast_playback_control` | Control Podcasts playback: play, pause, next, previous. | ❌ |
| `play_podcast_episode` | Play a specific podcast episode by name, optionally from a specific show. | ❌ |
| `search_podcast_episodes` | Search across all podcast episodes by name or description. | ✅ |

## Quick Examples

```
// Browse shows
"List my podcast subscriptions"

// Episodes
"Show the latest episodes of 'The Daily'"

// Playback
"What podcast is playing?" / "Pause the podcast"

// Search
"Search for podcast episodes about 'AI'"
```

## Permissions

Requires **Automation** permission for Apple Podcasts (Podcasts.app).
