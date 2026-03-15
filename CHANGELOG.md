# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Centralized hardcoded constants into `constants.ts` (timeouts, buffers, limits, paths)
- Security: `execSync` replaced with `execFileSync` in CLI commands
- Security: Gemini API key moved from URL query to `x-goog-api-key` header
- Security: Path traversal validation added to `send_file` tool
- Removed duplicate `MCP_CLIENTS` arrays (shared via `config.ts`)

## [2.1.0] - 2026-03-15

### Added
- `--help` command with usage guide
- Creator profile page
- Polished CLI UX with spinner animations and shared styles
- `npx airmcp doctor` diagnostic overhaul

## [2.0.0] - 2026-03-14

### Added
- 252 MCP tools across 25 modules
- Full Apple ecosystem integration (Notes, Calendar, Reminders, Contacts, Mail, Messages, Music, Finder, Safari, System, Photos, Shortcuts, Intelligence, TV, Screen, Maps, Podcasts, Weather, Pages, Numbers, Keynote, Location, Bluetooth, Google Workspace)
- Semantic search with Gemini embeddings + on-device Swift embeddings
- Human-in-the-loop (HITL) approval system with SwiftUI companion app
- Interactive setup wizard (`npx airmcp init`)
- Skill engine with YAML-based workflows
- Cross-module prompts (31 prompts)
- MCP resources (12 resources)
- HTTP/SSE transport mode
- Internationalization (9 languages)
