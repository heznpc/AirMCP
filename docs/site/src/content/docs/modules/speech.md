---
title: Speech
description: On-device speech recognition, audio transcription, and smart clipboard with type detection.
---

## Tools

| Tool | Description | Read-only |
|------|-------------|-----------|
| `transcribe_audio` | Transcribe an audio file to text using Apple's on-device speech recognition. Supports most audio formats (m4a, mp3, wav, caf). | ✅ |
| `speech_availability` | Check if on-device speech recognition is available and authorized. | ✅ |
| `smart_clipboard` | Get clipboard content with automatic type detection (text, URL, email, phone, date, file path, image). More structured than raw clipboard access. | ✅ |

## Quick Examples

```
// Transcribe audio
"Transcribe the audio file at /tmp/meeting.m4a"

// Check availability
"Is speech recognition available on this device?"

// Smart clipboard
"What's on my clipboard and what type of content is it?"
```

## Permissions

Requires **Speech Recognition** permission. The first use may trigger a macOS permission dialog. Requires the macOS Swift bridge. The `transcribe_audio` tool supports language selection (e.g. 'en-US', 'ko-KR', 'ja-JP').
