import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'index.js');

const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log('[non-JSON stdout]', line);
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else {
      console.log('[notification]', JSON.stringify(msg));
    }
  }
});

child.stderr.on('data', (chunk) => {
  console.error('[stderr]', chunk.toString('utf8').trim());
});

child.on('exit', (code, signal) => {
  console.log(`[server exited] code=${code} signal=${signal}`);
});

function send(method, params) {
  const id = nextId++;
  const req = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify(req) + '\n');
  });
}

function sendNotification(method, params) {
  const note = { jsonrpc: '2.0', method, params };
  child.stdin.write(JSON.stringify(note) + '\n');
}

async function main() {
  const initRes = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.1' }
  });
  console.log('initialize ->', JSON.stringify(initRes.result));

  sendNotification('notifications/initialized', {});

  const toolsRes = await send('tools/list', {});
  console.log('tools/list ->', JSON.stringify(toolsRes.result?.tools?.map((t) => t.name)));

  const runCall = process.argv.includes('--call');
  if (runCall) {
    const toolName = process.argv[process.argv.indexOf('--call') + 1];
    const argsJson = process.argv[process.argv.indexOf('--call') + 2];
    const args = argsJson ? JSON.parse(argsJson) : {};
    const callRes = await send('tools/call', { name: toolName, arguments: args });
    console.log(`tools/call(${toolName}) ->`, JSON.stringify(callRes.result, null, 2));
  }

  child.stdin.end();
  child.kill();
}

main().catch((err) => {
  console.error(err);
  child.kill();
  process.exit(1);
});
