#!/usr/bin/env node
// src/mcp/server.ts
// Refactron MCP server (stdio). Exposes `verify_change` so an AI agent can verify
// a proposed change before it lands. Runs entirely local.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  verifyChangeInputSchema,
  handleVerifyChange,
  type VerifyChangeArgs,
} from './tools/verify-change.js';

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
const version = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

const server = new McpServer({ name: 'refactron', version });

// `McpServer.tool(...)` is deprecated in @modelcontextprotocol/sdk >=1.x; the
// current registration API is `registerTool(name, config, cb)`.
server.registerTool(
  'verify_change',
  {
    description:
      "Verify a proposed code change (an AI agent's, a codemod's, or a human's) against the repo's real tests, and return a SAFE/UNSAFE/UNPROVEN verdict. Runs entirely local; never mutates the repo.",
    inputSchema: verifyChangeInputSchema,
  },
  async (args) => handleVerifyChange(args as VerifyChangeArgs),
);

const transport = new StdioServerTransport();
await server.connect(transport);
