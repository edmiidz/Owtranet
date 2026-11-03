import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { webmailRequest } from './api.js';

export const TOOLS = [
  {
    name: 'list_mailboxes',
    description: 'List the folders/mailboxes in the intranet webmail account (INBOX, Sent, Drafts, etc.).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_messages',
    description: 'List recent messages in a mailbox, most recent first. Returns headers only (no full body).',
    inputSchema: {
      type: 'object',
      properties: {
        mailbox: { type: 'string', description: 'Mailbox/folder name, e.g. INBOX, Sent, Drafts.', default: 'INBOX' },
        limit: { type: 'integer', description: 'Max messages to return.', default: 50, minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_message',
    description: 'Fetch the full content (headers, text, html, attachment list) of a single message by its IMAP UID.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'integer', description: 'IMAP UID of the message, from list_messages/search_messages.' },
        mailbox: { type: 'string', description: 'Mailbox/folder the message lives in.', default: 'INBOX' }
      },
      required: ['uid'],
      additionalProperties: false
    }
  },
  {
    name: 'search_messages',
    description: 'Full-text search for messages within a mailbox.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in message content.' },
        mailbox: { type: 'string', description: 'Mailbox/folder to search.', default: 'INBOX' },
        limit: { type: 'integer', description: 'Max messages to return.', default: 50, minimum: 1, maximum: 200 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'create_draft',
    description: 'Save a new draft message to the Drafts folder. Does NOT send the message.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient address(es), comma-separated.' },
        cc: { type: 'string', description: 'CC address(es), comma-separated.' },
        bcc: { type: 'string', description: 'BCC address(es), comma-separated.' },
        subject: { type: 'string', description: 'Subject line.' },
        text: { type: 'string', description: 'Plain-text body.' }
      },
      additionalProperties: false
    }
  }
];

function textResult(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(err) {
  return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
}

/**
 * Build an MCP Server wired to the intranet webmail API.
 *
 * @param {object} [opts]
 * @param {() => (string|Promise<string>)} [opts.getToken]
 *   Returns the JWT to send to /api/webmail/*. When omitted, lib/api.js falls
 *   back to the token saved by `npm run login` (~/.config/owtranet/webmail-token).
 *   The HTTP entrypoint (http.js) passes a function that mints a short-lived JWT
 *   with the intranet's JWT_SECRET instead.
 */
export function createServer({ getToken } = {}) {
  const server = new Server(
    { name: 'owtranet-webmail', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const call = async (pathSuffix, opts = {}) =>
      webmailRequest(pathSuffix, { ...opts, token: getToken ? await getToken() : undefined });

    try {
      switch (name) {
        case 'list_mailboxes': {
          const data = await call('/api/webmail/mailboxes');
          return textResult(data.mailboxes);
        }

        case 'list_messages': {
          const { mailbox = 'INBOX', limit = 50 } = args;
          const data = await call('/api/webmail/inbox', { query: { mailbox, limit } });
          return textResult(data.emails);
        }

        case 'get_message': {
          const { uid, mailbox = 'INBOX' } = args;
          if (uid === undefined) throw new Error('uid is required');
          const data = await call(`/api/webmail/emails/${encodeURIComponent(uid)}`, { query: { mailbox } });
          return textResult(data.email);
        }

        case 'search_messages': {
          const { query, mailbox = 'INBOX', limit = 50 } = args;
          if (!query) throw new Error('query is required');
          const data = await call('/api/webmail/search', { query: { q: query, mailbox, limit } });
          return textResult(data.emails);
        }

        case 'create_draft': {
          const { to, cc, bcc, subject, text } = args;
          const data = await call('/api/webmail/draft', {
            method: 'POST',
            body: { to, cc, bcc, subject, text }
          });
          return textResult(data);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return errorResult(err);
    }
  });

  return server;
}
