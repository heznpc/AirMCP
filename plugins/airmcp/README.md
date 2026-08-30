# AirMCP plugin

AirMCP is a maintained, permission-aware MCP bridge between ChatGPT and Apple apps on macOS. This plugin packages the AirMCP tool connection with instructions for safely identifying and acting on Notes, Reminders, Calendar, Finder, Shortcuts, screen capture, and the other capabilities exposed by the user's local runtime.

The plugin does not contain an AI assistant or a native iOS Simulator/device controller. It only exposes tools that the connected AirMCP runtime actually advertises.

## Architecture

```text
ChatGPT or Codex
  -> AirMCP plugin and registered MCP connection
  -> Secure MCP Tunnel (private developer testing)
  -> clean signed-app bootstrap
  -> plugins/airmcp/scripts/airmcp-app-stdio.mjs
  -> signed AirMCP.app-owned runtime
  -> Apple apps on this Mac
```

The connector first verifies the installed app against its Apple trust anchor, bundle identity, and team requirement, then binds the live loopback listener to the current user's bundled Node runtime, exact server command, and signed AirMCP app parent. It verifies a fresh owner-secret HMAC challenge bound to that listener PID and runtime version and derives a bearer valid only for that runtime generation. An occupied or unverified port fails closed. If the verified app is open but its child has stopped, the connector delivers only `airmcp://runtime/start` to that exact bundle path. The app re-probes and resumes only when auto-start and an existing runtime token prove prior user authorization. The persistent app token is never read, forwarded, or created by the connector, and neither credential is stored in the plugin manifest or tunnel command.

## Validate the source package

From the AirMCP repository root:

```bash
npm run plugin:validate
npm run plugin:preflight
npm run plugin:recovery
```

The recovery gate terminates only the already verified app-owned child, then proves that the app restores a fresh generation, the old connector and bearer fail closed, and a new connector can call `profile_status`.

The source package intentionally has no `.app.json` and no `apps` field. A ChatGPT developer connection must exist before either value can be real.

## Private ChatGPT developer-mode setup

1. Install and open the signed `AirMCP.app`, enable its local runtime, and verify the macOS permissions needed by the intended test cases with representative tool calls.
2. In OpenAI Platform tunnel settings, create a tunnel and obtain its `tunnel_id` and a runtime API key.
3. Configure `tunnel-client` with this plugin's connector as its stdio command:

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

4. Enable developer mode under ChatGPT **Settings → Security and login**. At [ChatGPT Plugins](https://chatgpt.com/plugins), create a connection using **Tunnel**, select the tunnel, review the discovered tools, and copy the technical ID beginning with `plugin_asdk_app` from the browser URL.
5. In another terminal, stage a local test package with that real ID:

   ```bash
   npm run plugin:stage -- --app-id plugin_asdk_app_...
   ```

   The generated plugin is at `build/chatgpt-plugin/plugins/airmcp`; its local marketplace is `build/chatgpt-plugin/.agents/plugins/marketplace.json`. Staging adds a UTC `+codex.local-YYYYMMDD-HHMMSS` cachebuster to the copied manifest so reinstalling loads the current package without changing the source version.

6. Add and install the staged marketplace:

   ```bash
   codex plugin marketplace add "$PWD/build/chatgpt-plugin"
   codex plugin add airmcp@airmcp-local
   ```

7. Restart the ChatGPT desktop app, verify AirMCP under Personal/Installed in the Plugins Directory, then start a new Chat with the plugin enabled. Run the cases in `evals/chatgpt.json` and record tool arguments, results, errors, and confirmation behavior.

After changing the source plugin, restage with `npm run plugin:stage -- --app-id plugin_asdk_app_... --force`, rerun `codex plugin add airmcp@airmcp-local`, restart the app, and test in a new Chat so the updated skills and connection mapping are loaded.

This is a private developer-mode path. Secure MCP Tunnel cannot be used for public plugin submission. See the complete [ChatGPT plugin runbook](https://github.com/heznpc/AirMCP/blob/main/docs/chatgpt-plugin.md) for TCC preflight checks and the separate public-deployment boundary.

## Support and policy

- [Support](https://github.com/heznpc/AirMCP/issues)
- [Privacy policy](https://github.com/heznpc/AirMCP/blob/main/docs/PRIVACY_POLICY.md)
- [Terms of service](https://github.com/heznpc/AirMCP/blob/main/docs/TERMS_OF_SERVICE.md)
