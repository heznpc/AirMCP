/**
 * Mock MCP server factory for tool registration tests.
 *
 * Supports:
 *   - tool() / registerTool() — captures tool registrations
 *   - callTool(name, args) — invokes a registered tool handler
 *   - server.server — nested property for HITL guard compatibility
 *   - _tools Map — direct access to registered tools for assertions
 */
import { jest } from '@jest/globals';
import { z } from 'zod';

export function createMockServer() {
  const tools = new Map();
  const prompts = new Map();

  const server = {
    /** Nested server property used by HITL guard and sampling (createMessage). */
    server: {
      createMessage: jest.fn(),
    },

    /** Capture a tool registration (matches McpServer.registerTool signature). */
    registerTool: jest.fn((name, opts, handler) => {
      tools.set(name, { name, opts, handler });
    }),

    /** Legacy SDK registration shape used by a small number of modules. */
    tool: jest.fn((name, ...rest) => {
      const handler = rest.at(-1);
      tools.set(name, { name, opts: {}, handler });
    }),

    registerPrompt: jest.fn((name, opts, handler) => {
      prompts.set(name, { name, opts, handler });
    }),

    prompt: jest.fn((name, ...rest) => {
      prompts.set(name, { name, opts: {}, handler: rest.at(-1) });
    }),

    /** Direct access to registered tools for assertions. */
    _tools: tools,
    _prompts: prompts,

    /**
     * Invoke a registered tool through the same input-schema boundary as the
     * MCP SDK. Defaults, transforms, and validation must run before the
     * handler; bypassing this step creates false-positive tool tests.
     */
    async callTool(name, args = {}) {
      const entry = tools.get(name);
      if (!entry) {
        throw new Error(`Tool "${name}" is not registered. Available: ${[...tools.keys()].join(', ')}`);
      }
      const input = entry.opts?.inputSchema;
      if (input === undefined) return entry.handler(args);
      const schema = typeof input.safeParse === 'function' ? input : z.object(input);
      return entry.handler(schema.parse(args));
    },
  };

  return server;
}
