// Local stdio entrypoint (Claude Code / desktop MCP clients).
// Uses the JWT saved by `npm run login`. For the hosted HTTP variant that
// ElevenLabs agents call, see http.js.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './lib/server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
