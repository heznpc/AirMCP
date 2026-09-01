import { describe, test, expect, jest } from "@jest/globals";
import { z } from "zod";
import { createMockServer } from "./helpers/mock-server.js";

describe("mock MCP server schema boundary", () => {
  test("applies defaults and transforms before invoking a registered handler", async () => {
    const server = createMockServer();
    const handler = jest.fn(async (args) => args);
    server.registerTool(
      "schema_tool",
      {
        inputSchema: {
          path: z
            .string()
            .transform((value) => `/resolved/${value}`)
            .prefault("home"),
          limit: z.number().int().default(10),
        },
      },
      handler,
    );

    await expect(server.callTool("schema_tool")).resolves.toEqual({ path: "/resolved/home", limit: 10 });
    expect(handler).toHaveBeenCalledWith({ path: "/resolved/home", limit: 10 });
  });

  test("rejects invalid input without invoking the handler", async () => {
    const server = createMockServer();
    const handler = jest.fn();
    server.registerTool("schema_tool", { inputSchema: { count: z.number().int().min(1) } }, handler);

    await expect(server.callTool("schema_tool", { count: 0 })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
