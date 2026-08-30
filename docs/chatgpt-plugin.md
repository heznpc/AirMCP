# AirMCP plugin for personal ChatGPT Chat

This runbook takes the AirMCP plugin through private developer-mode installation and evaluation in a personal ChatGPT Chat. It stops before public deployment, submission, review, or publication.

OpenAI's current plugin model supports plugins in both Chat and Work. Work is not required for this path, but the account must expose ChatGPT developer mode and the matching personal Platform organization must have tunnel access. Availability can still depend on account or workspace policy.

## What is being tested

```text
personal ChatGPT Chat
  -> locally staged AirMCP plugin
  -> registered developer-mode MCP connection
  -> OpenAI Secure MCP Tunnel
  -> AirMCP plugin stdio connector
  -> signed AirMCP.app-owned loopback runtime
  -> enabled Apple-app tools and macOS permissions
```

The signed app-owned runtime is the stable local permission subject. The connector verifies a fresh owner-secret HMAC challenge bound to the listener PID and AirMCP version, then derives a bearer valid only for that app-owned runtime generation. It never reads or forwards the persistent app runtime token. When the app is alive but its child has stopped, the connector can deliver the exact `airmcp://runtime/start` route to the verified bundle; the app accepts it only for a previously authorized runtime and rotates the generation credential on restart. The plugin source never stores the app runtime token, owner secret, tunnel runtime API key, or a ChatGPT connection ID.

The repository plugin at `plugins/airmcp` intentionally contains `.mcp.json` but not `.app.json`. Its `.codex-plugin/plugin.json` intentionally omits `apps`. `scripts/stage-chatgpt-plugin.mjs` adds the real registered connection mapping only to a generated copy under ignored `build/` output.

## Prerequisites

- macOS with the signed `AirMCP.app` installed at `/Applications/AirMCP.app`.
- AirMCP.app local runtime explicitly enabled at least once, so its owner-only persistent token already exists. The connector accepts only the fixed app-owned loopback `/mcp` runtime and validates the installed app against its Apple trust anchor, bundle identity, and team requirement, then binds the live listener PID, current-user UID, bundled runtime executable and command, and signed app parent. It next verifies a fresh HMAC identity challenge using the owner-only app secret and derives a generation-scoped bearer. The persistent token never crosses the connector boundary. An occupied or unverified port fails closed.
- Node.js for the plugin connector and repository scripts.
- A personal ChatGPT account where **Settings → Security and login → Developer mode** is available.
- A personal OpenAI Platform organization with a tunnel `tunnel_id`, a tunnel runtime API key, and Tunnels Read + Use access. Creating or editing the tunnel also needs Tunnels Read + Manage.
- The current [`tunnel-client`](https://github.com/openai/tunnel-client/releases/latest), downloaded from [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels) or its latest public release.

Do not place the tunnel runtime API key in a manifest, command argument, committed file, screenshot, or issue. Supply it through `CONTROL_PLANE_API_KEY` only to the terminal running `tunnel-client`.

## 1. Validate the source plugin

From the repository root:

```bash
npm run plugin:validate
```

This validates the source manifest, skill, local MCP configuration, scripts, assets, and policy surfaces. It must also confirm that the source package has no `.app.json`, `apps` mapping, `plugin_asdk_app...` identifier, local runtime token, or hard-coded user path.

Do not stage with an invented connection ID. The ID is assigned only after ChatGPT registers the developer MCP connection.

## 2. Preflight the app-owned runtime and TCC permissions

Start the connector through MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest \
  /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  /bin/sh "$PWD/plugins/airmcp/scripts/launch-airmcp-connector.sh"
```

The connector may ask the exact verified `/Applications/AirMCP.app` to resume a previously enabled runtime on demand. It checks for owner-only existing consent metadata without reading the token, delivers the canonical deep link without foregrounding the app, and still treats readiness plus listener identity as the authority. A successful connection proves that the Apple-anchored signed app, owner-only identity secret, verified app-child listener, HMAC identity challenge, generation-scoped authorization, app-owned health response, and stdio-to-loopback proxy are usable. It does **not** prove that every macOS TCC permission is granted.

After the ordinary preflight passes, run the destructive-but-self-restoring availability gate once against the installed test build:

```bash
npm run plugin:recovery
```

It signals only the exact verified app child, starts a fresh connector, and requires the old connector and bearer to fail closed while the new generation completes `profile_status`.

In Inspector, review the advertised tools and call a representative read-only tool for each capability this ChatGPT test will use. Examples:

- Notes: `search_notes` followed by `read_note` on a harmless known note.
- Reminders: `list_reminder_lists` or `list_reminders`.
- Calendar: `list_calendars` and `list_events` for a narrow range.
- Finder: `search_files` in a harmless folder followed by `get_file_info`.
- Shortcuts: `list_shortcuts`; do not run a side-effecting shortcut during preflight.
- Screen or accessibility modules, only when they are part of the intended test: call the actual read/capture operation. A device-capability or permission-status report alone is not proof that the action is authorized.

If an intended tool is absent, inspect `profile_status` and use `discover_tools`. Enable the relevant AirMCP module/profile before continuing; do not treat an absent tool as supported. If a call returns a TCC denial, grant the named permission to the signed AirMCP app in macOS and rerun the same representative call. Do not switch to a direct terminal-owned AirMCP process as a workaround.

Permissions are installation-specific state, so they are always checked in this preflight. They are not encoded as a permanent product claim in the plugin manifest or listing copy.

## 3. Create and run the Secure MCP Tunnel

In [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), create a tunnel associated with the personal Platform organization and the target ChatGPT context. Copy its `tunnel_id` and create a runtime API key.

From the repository root, configure a named stdio profile using the plugin connector:

```bash
export AIRMCP_TUNNEL_ID="tunnel_..."
printf 'Tunnel runtime API key: '
IFS= read -r -s CONTROL_PLANE_API_KEY
export CONTROL_PLANE_API_KEY
printf '\n'

tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile airmcp-chatgpt \
  --tunnel-id "$AIRMCP_TUNNEL_ID" \
  --mcp-command "/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/sh \"$PWD/plugins/airmcp/scripts/launch-airmcp-connector.sh\""

tunnel-client doctor --profile airmcp-chatgpt --explain
tunnel-client run --profile airmcp-chatgpt
```

Leave `tunnel-client run` healthy while registering and testing the connection. It creates an outbound HTTPS path to OpenAI and does not expose the local AirMCP listener as an inbound public service.

## 4. Register the MCP connection in personal ChatGPT

1. In ChatGPT, open **Settings → Security and login** and turn on **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and select the plus button.
3. Enter the user-facing name and description for the AirMCP development connection.
4. Under **Connection**, choose **Tunnel**, then select the configured tunnel or enter its `tunnel_id`.
5. Create the connection and review every discovered tool and its metadata. Confirm that Chat exposes one AirMCP tool set rather than duplicate local and tunnel copies. Resolve transport, initialization, schema, annotation, or permission errors before continuing.
6. Copy the connection's technical ID from the browser URL. It begins with `plugin_asdk_app`.

The connection itself can be tested from a new Chat before packaging. Run at least one direct read prompt, one indirect read prompt, one follow-up that reuses a returned ID, one confirmed write, and one unsupported prompt that must not call a tool.

## 5. Stage the plugin with the real connection ID

From the repository root:

```bash
npm run plugin:stage -- --app-id plugin_asdk_app_...
```

The default staging output is:

- Plugin: `build/chatgpt-plugin/plugins/airmcp`
- Marketplace: `build/chatgpt-plugin/.agents/plugins/marketplace.json`

Before installation, verify all of the following:

- `build/chatgpt-plugin/plugins/airmcp/.app.json` maps AirMCP to the exact registered technical ID.
- The staged `.codex-plugin/plugin.json` has `"apps": "./.app.json"`.
- The staged manifest version is the source version plus one UTC `+codex.local-YYYYMMDD-HHMMSS` cachebuster. The source manifest version remains unchanged.
- The source `plugins/airmcp/.codex-plugin/plugin.json` still has no `apps` field and the source plugin still has no `.app.json`.
- The staged package contains no tunnel key, local runtime token, or personal path.
- The staged marketplace name is `airmcp-local` and points to `./plugins/airmcp`.

Staging output is local build state. Do not commit it.

## 6. Add the local marketplace and install

The staged marketplace is not in a default discovery path. Add it explicitly, then install AirMCP:

```bash
codex plugin marketplace add "$PWD/build/chatgpt-plugin"
codex plugin add airmcp@airmcp-local
```

Restart the ChatGPT desktop app. In the Plugins Directory, verify AirMCP under the Personal/Installed source. Start a **new Chat**, enable AirMCP, and test there; existing chats may retain the previous skill and tool snapshot.

After any source change:

1. Rerun `npm run plugin:validate`.
2. Restage with the same registered technical ID: `npm run plugin:stage -- --app-id plugin_asdk_app_... --force`.
3. Rerun `codex plugin add airmcp@airmcp-local` to reinstall.
4. Restart ChatGPT and use a new Chat.

When server tool names, schemas, descriptions, annotations, authentication, or resources change, also open the developer connection in ChatGPT Plugins, select **Refresh**, review the new metadata, and rerun the affected cases.

## 7. Run the evaluation set

Use `plugins/airmcp/evals/chatgpt.json` as the release candidate set. It contains five positive and three negative cases. For every case, record:

- whether the plugin and skill activated;
- selected tool names and exact arguments;
- model-visible result and any error;
- whether an exact target was read before mutation;
- confirmation and AirMCP HITL behavior;
- whether denied, timed-out, unavailable, or unsupported actions stopped without a workaround;
- whether success was claimed only after a successful result.

Writes, sends, deletes, file trashing, and side-effecting Shortcut runs must show their exact target and effect before the call. A ChatGPT confirmation does not replace AirMCP's HITL decision, and an AirMCP approval does not excuse ambiguous model arguments.

## Public deployment boundary

This runbook deliberately stops at private personal developer-mode installation. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) supports private development connections but cannot be used for public plugin submission or public distribution.

Public publication is a separate product and security project. For AirMCP it would require, at minimum:

- a stable, publicly reachable streamable-HTTP MCP endpoint, normally at HTTPS `/mcp`, rather than the per-Mac loopback listener or tunnel;
- control of the MCP host and [domain verification](https://developers.openai.com/plugins/deploy/submission) through `/.well-known/openai-apps-challenge`;
- a production multi-user authentication design, including OAuth appropriate to the hosted AirMCP service, rather than reusing the per-install local bearer token;
- reviewable tool annotations, privacy/data-flow disclosures, demo access, test cases, and OpenAI Platform developer identity verification;
- a design for how a hosted service securely reaches each user's Mac and preserves the correct local permission subject.

None of those public surfaces is created or published by `plugin:stage`. Do not submit the tunnel-backed connection to the public Plugins Directory.

## Official references

- [Plugins in ChatGPT and Codex](https://learn.chatgpt.com/docs/plugins)
- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
