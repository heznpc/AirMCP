---
title: Podcasts
description: Podcast shows, episodes, playback control, and episode search.
---

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
