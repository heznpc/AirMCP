import { EventEmitter } from "node:events";
import { describe, expect, jest, test } from "@jest/globals";

const { wireStdioShutdown } = await import("../dist/server/stdio-shutdown.js");

describe("stdio graceful shutdown wiring", () => {
  test.each(["end", "close"])("stdin %s requests shutdown exactly once", async (terminalEvent) => {
    const input = new EventEmitter();
    const transport = {};
    const shutdown = jest.fn(async () => {});
    wireStdioShutdown(transport, input, shutdown);

    input.emit(terminalEvent);
    input.emit(terminalEvent === "end" ? "close" : "end");
    transport.onclose();
    await Promise.resolve();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith(0);
  });

  test("preserves the transport close callback installed before SDK connect", async () => {
    const input = new EventEmitter();
    const previous = jest.fn();
    const transport = { onclose: previous };
    const shutdown = jest.fn(async () => {});
    wireStdioShutdown(transport, input, shutdown);

    transport.onclose();
    await Promise.resolve();

    expect(previous).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
