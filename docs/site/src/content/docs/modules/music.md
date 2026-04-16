---
title: Music
description: Full Apple Music control with playlists, playback, search, queue management, ratings, and favorites.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `list_playlists` | List all Music playlists with track counts and duration. | ✅ |
| `list_tracks` | List tracks in a playlist with name, artist, album, and duration. | ✅ |
| `now_playing` | Get the currently playing track and playback state. | ✅ |
| `playback_control` | Control Music playback: play, pause, nextTrack, previousTrack. | ❌ |
| `search_tracks` | Search tracks in Music library by name, artist, or album. | ✅ |
| `play_track` | Play a specific track by name, optionally from a specific playlist. | ❌ |
| `play_playlist` | Start playing a playlist by name, with optional shuffle control. | ❌ |
| `get_track_info` | Get detailed metadata for a specific track by name. | ✅ |
| `set_shuffle` | Enable/disable shuffle and set repeat mode (off, one, all). | ❌ |
| `create_playlist` | Create a new playlist in Music. | ❌ |
| `add_to_playlist` | Add a track to an existing playlist. | ❌ |
| `remove_from_playlist` | Remove a track from a playlist. | ❌ |
| `delete_playlist` | Delete an existing playlist from Music. | ❌ |
| `get_rating` | Get the rating, favorited, and disliked status for a track. | ✅ |
| `set_rating` | Set the star rating (0-100) for a track. Use multiples of 20 for full stars. | ❌ |
| `set_favorited` | Mark or unmark a track as favorited (loved). | ❌ |
| `set_disliked` | Mark or unmark a track as disliked. | ❌ |

## Quick Examples

```
// Check what's playing
"What song is currently playing?"

// Control playback
"Pause the music" / "Skip to the next track"

// Find and play
"Search for songs by Taylor Swift and play the first one"

// Manage playlists
"Create a playlist called 'Workout Mix' and add 'Eye of the Tiger' to it"
```

## Permissions

Requires **Automation** permission for Apple Music (Music.app).
