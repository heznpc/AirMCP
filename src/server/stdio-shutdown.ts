export interface StdioCloseTransport {
  onclose?: () => void;
}

export interface StdioEndSource {
  once(event: "end" | "close", listener: () => void): unknown;
}

/** Route every stdio terminal condition through the process's single-flight
 * graceful shutdown. The MCP SDK's StdioServerTransport listens only for data
 * and error, so stdin EOF/close must be wired explicitly. Install this before
 * server.connect(): the SDK preserves an existing transport.onclose callback
 * when it adds its protocol wrapper. */
export function wireStdioShutdown(
  transport: StdioCloseTransport,
  input: StdioEndSource,
  shutdown: (code?: number) => Promise<void>,
): void {
  let requested = false;
  const requestShutdown = () => {
    if (requested) return;
    requested = true;
    void shutdown(0);
  };
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    previousOnClose?.();
    requestShutdown();
  };
  input.once("end", requestShutdown);
  input.once("close", requestShutdown);
}
