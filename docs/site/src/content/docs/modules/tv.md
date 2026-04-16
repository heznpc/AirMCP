---
title: TV
description: Apple TV app control with playlists, playback, search, and content browsing.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `tv_list_playlists` | List all playlists (libraries) in Apple TV app. | ✅ |
| `tv_list_tracks` | List movies/episodes in a TV playlist. | ✅ |
| `tv_now_playing` | Get currently playing content in Apple TV app. | ✅ |
| `tv_playback_control` | Control Apple TV playback: play, pause, next, previous. | ❌ |
| `tv_search` | Search movies and TV shows by name or show title. | ✅ |
| `tv_play` | Play a movie or episode by name. | ❌ |

## Quick Examples

```
// Browse content
"List my TV library" / "What movies do I have?"

// Playback
"What's currently playing on Apple TV?"
"Pause the TV" / "Play 'The Morning Show'"

// Search
"Search for 'Severance' in my TV library"
```

## Permissions

Requires **Automation** permission for Apple TV (TV.app).
