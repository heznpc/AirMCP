---
title: Configuration
description: Configure AirMCP modules, environment variables, and HTTP mode.
---

AirMCP can be configured through a JSON config file, environment variables, or CLI flags. Environment variables always take precedence over config file values.

## Config File

The default config file location is `~/.config/airmcp/config.json`. You can override this with the `AIRMCP_CONFIG_PATH` environment variable.

```json
{
  "includeShared": false,
  "allowSendMessages": false,
  "allowSendMail": false,
  "disabledModules": ["tv", "podcasts"],
  "shareApproval": ["notes", "calendar"],
  "hitl": {
    "level": "destructive-only",
    "whitelist": ["list_notes", "search_notes"],
    "timeout": 30
  },
  "performance": {
    "embeddingProvider": "swift",
    "jxaConcurrency": 3,
    "circuitBreakerThreshold": 3,
    "circuitBreakerOpenMs": 60000
  }
}
```

### Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `includeShared` | boolean | `false` | Include shared notes/folders in results |
| `allowSendMessages` | boolean | `false` | Allow sending iMessages via the Messages module |
| `allowSendMail` | boolean | `false` | Allow sending emails via the Mail module |
| `disabledModules` | string[] | `[]` | List of module names to disable |
| `shareApproval` | string[] | `[]` | Modules that require share approval before accessing |
| `hitl.level` | string | `"off"` | Human-in-the-loop level: `off`, `destructive-only`, `all-writes`, `all` |
| `hitl.whitelist` | string[] | `[]` | Tool names that bypass HITL confirmation |
| `hitl.timeout` | number | `30` | Seconds to wait for HITL confirmation |
| `performance.embeddingProvider` | string | `"auto"` | Embedding provider: `gemini`, `swift`, `hybrid`, `none` |
| `performance.jxaConcurrency` | number | `3` | Max parallel JXA/osascript processes |
| `performance.circuitBreakerThreshold` | number | `3` | Failures before circuit breaker opens |
| `performance.circuitBreakerOpenMs` | number | `60000` | Circuit breaker open duration in ms |

## Environment Variables

### Module Control

| Variable | Description |
|----------|-------------|
| `AIRMCP_FULL=true` | Enable all 29 modules (ignores disabledModules) |
| `AIRMCP_DISABLE_<MODULE>=true` | Disable a specific module (e.g. `AIRMCP_DISABLE_TV=true`) |
| `AIRMCP_CONFIG_PATH` | Override config file path (default: `~/.config/airmcp/config.json`) |

### Safety Controls

| Variable | Description |
|----------|-------------|
| `AIRMCP_ALLOW_SEND_MESSAGES=true` | Allow sending iMessages |
| `AIRMCP_ALLOW_SEND_MAIL=true` | Allow sending emails |
| `AIRMCP_INCLUDE_SHARED=true` | Include shared Notes/folders |
| `AIRMCP_SHARE_APPROVAL=notes,calendar` | Comma-separated list of modules requiring share approval |
| `AIRMCP_HITL_LEVEL=destructive-only` | Human-in-the-loop confirmation level |

### HTTP Mode

| Variable | Description |
|----------|-------------|
| `AIRMCP_HTTP_TOKEN` | Bearer token for HTTP mode authentication. **Required** when using `--bind-all` |
| `AIRMCP_HTTP_PORT` | HTTP server port (default: `3847`) |
| `AIRMCP_MAX_SESSIONS` | Max concurrent HTTP sessions (default: `50`) |
| `AIRMCP_SESSION_IDLE_TTL` | Session idle timeout in ms (default: `300000` / 5 minutes) |

### Performance Tuning

| Variable | Description |
|----------|-------------|
| `AIRMCP_JXA_CONCURRENCY` | Max parallel JXA processes (default: `3`) |
| `AIRMCP_TIMEOUT_JXA` | JXA script timeout in ms (default: `30000`) |
| `AIRMCP_TIMEOUT_SWIFT` | Swift bridge timeout in ms (default: `60000`) |
| `AIRMCP_BUFFER_JXA` | JXA stdout buffer size in bytes (default: `10485760` / 10 MB) |
| `AIRMCP_BUFFER_SWIFT` | Swift bridge stdout buffer in bytes (default: `10485760` / 10 MB) |
| `AIRMCP_CB_THRESHOLD` | Circuit breaker failure threshold (default: `3`) |
| `AIRMCP_CB_OPEN_MS` | Circuit breaker open duration in ms (default: `60000`) |

### Embeddings

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Gemini API key for cloud-based embeddings |
| `AIRMCP_EMBEDDING_PROVIDER` | Provider selection: `auto`, `gemini`, `swift`, `hybrid`, `none` |
| `AIRMCP_EMBEDDING_MODEL` | Gemini model name (default: `gemini-embedding-2-preview`) |
| `AIRMCP_EMBEDDING_DIM` | Embedding dimension (default: `3072`) |

## CLI Flags

```bash
npx airmcp                    # Start in stdio mode (default)
npx airmcp --http             # Start as HTTP server
npx airmcp --http --port 8080 # Custom port
npx airmcp --http --bind-all  # Bind to 0.0.0.0 (all interfaces)
npx airmcp --full             # Enable all modules
npx airmcp init               # Interactive setup wizard
npx airmcp doctor             # Diagnose installation
npx airmcp --help             # Show usage guide
```

## HTTP Mode Details

When running in HTTP mode (`--http`), AirMCP uses the MCP Streamable HTTP transport:

- **Endpoint**: `POST /mcp` for all MCP requests
- **Health check**: `GET /health` returns server status, version, and session count
- **Discovery**: `GET /.well-known/mcp.json` returns the MCP Server Card
- **SSE streaming**: `GET /mcp` with `mcp-session-id` header for server-sent events
- **Session close**: `DELETE /mcp` with `mcp-session-id` header

### Authentication

When `AIRMCP_HTTP_TOKEN` is set, all requests (except `/health` and `/.well-known/mcp.json`) must include a `Bearer` token in the `Authorization` header:

```bash
export AIRMCP_HTTP_TOKEN="my-secret-token"
npx airmcp --http --bind-all
```

Clients connect with:

```
Authorization: Bearer my-secret-token
```

Using `--bind-all` without `AIRMCP_HTTP_TOKEN` prints a security warning. On a trusted local network this may be acceptable, but for any internet-facing deployment, always set a token.

## Starter Modules

When no `config.json` exists and `--full` is not used, AirMCP enables a curated starter set:

- **Notes** -- read, create, update, delete notes and folders
- **Reminders** -- manage tasks and reminder lists
- **Calendar** -- view and create events
- **Shortcuts** -- list and run Siri Shortcuts
- **System** -- clipboard, volume, brightness, app control
- **Finder** -- file search, directory listing, file operations
- **Weather** -- current conditions and forecasts

All other modules are disabled by default. Use `npx airmcp init` to customize, or pass `--full` to enable everything.
